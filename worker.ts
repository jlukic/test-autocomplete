ill share the whole shebang so you have the entire context



bare-module-transformer.ts

```

/**

 * @license

 * Copyright 2021 Google LLC

 * SPDX-License-Identifier: BSD-3-Clause

 */



import * as esModuleLexer from 'es-module-lexer';

import {

  MergedAsyncIterables,

  parseNpmStyleSpecifier,

  resolveUrlPath,

  charToLineAndChar,

  fileExtension,

  classifySpecifier,

  relativeUrlPath,

} from './util.js';

import {Deferred} from '../shared/deferred.js';

import {NodeModuleResolver} from './node-module-resolver.js';



import {

  BuildOutput,

  DiagnosticBuildOutput,

  FileBuildOutput,

  SampleFile,

} from '../shared/worker-api.js';

import {ImportMapResolver} from './import-map-resolver.js';

import {CachingCdn} from './caching-cdn.js';

import {NpmFileLocation, PackageJson} from './util.js';



/**

 * Transforms bare module specifiers in .js files to canonical local paths, and

 * adds the corresponding modules to the virtual filesystem.

 *

 * For example, transforms:

 *   import {html} from "lit";

 * Into:

 *   import {html} from "./node_modules/lit@2.1.2/index.js";

 *

 * Dependencies are served from within the local

 * "<service-worker-scope>/node_modules/" path. This allows us to transform not

 * only our own project files, but the entire module dependency graph too.

 *

 * Specifiers are canonicalized to include the latest concrete version that is

 * compatible with the semver range, and to make default modules and file

 * extensions explicit. This provides improved module de-duplication over

 * unpkg.com's "?module" mode, which does not canonicalize.

 *

 * Version constraints are read from the "dependencies" field of package.json

 * files, both in dependencies and in the top-level project itself. If the

 * project doesn't contain a package.json file, the latest versions are assumed.

 */

export class BareModuleTransformer {

  private _cdn: CachingCdn;

  private _importMapResolver: ImportMapResolver;

  private _emittedExternalDependencies = new Set<string>();

  private _nodeResolver = new NodeModuleResolver({

    conditions: ['module', 'import', 'development', 'browser'],

  });



  constructor(cdn: CachingCdn, importMapResolver: ImportMapResolver) {

    this._cdn = cdn;

    this._importMapResolver = importMapResolver;

  }



  async *process(

    results: AsyncIterable<BuildOutput> | Iterable<BuildOutput>

  ): AsyncIterable<BuildOutput> {

    // This "output" iterable helps us emit all build outputs as soon as they

    // are available as we asynchronously walk the dependency tree.

    const output = new MergedAsyncIterables<BuildOutput>();

    output.add(this._handleProjectFiles(results, output));

    yield* output;

  }



  /**

   * Handle files from the top-level project.

   */

  private async *_handleProjectFiles(

    results: AsyncIterable<BuildOutput> | Iterable<BuildOutput>,

    output: MergedAsyncIterables<BuildOutput>

  ): AsyncIterable<BuildOutput> {

    // The project might contain a package.json, which will determine our

    // top-level version constraints. Resolve it lazily.

    const packageJson = new Deferred<PackageJson | undefined>();

    const getPackageJson = () => packageJson.promise;

    for await (const result of results) {

      if (result.kind === 'file' && result.file.name.endsWith('.js')) {

        output.add(this._handleModule(result, getPackageJson, output));

      } else {

        yield result;

        if (result.kind === 'file' && result.file.name === 'package.json') {

          let parsed: PackageJson | undefined;

          try {

            parsed = JSON.parse(result.file.content) as PackageJson;

          } catch (e) {

            yield makeJsonParseDiagnostic(e as Error, result.file);

          }

          if (parsed !== undefined) {

            packageJson.resolve(parsed);

          }

        }

      }

    }

    if (!packageJson.settled) {

      // We never found a package.json.

      packageJson.resolve(undefined);

    }

  }



  /**

   * Transform all of the imported module specifiers in the given JS module,

   * emit the transformed file, and process any dependencies corresponding to

   * those specifiers.

   */

  private async *_handleModule(

    file: FileBuildOutput,

    getPackageJson: () => Promise<PackageJson | undefined>,

    output: MergedAsyncIterables<BuildOutput>

  ): AsyncIterable<BuildOutput> {

    let js = file.file.content;

    let specifiers;

    await esModuleLexer.init;

    try {

      [specifiers] = esModuleLexer.parse(js);

    } catch (e) {

      yield file;

      const diagnostic = makeEsModuleLexerDiagnostic(

        e as Error,

        file.file.name

      );

      if (diagnostic !== undefined) {

        yield diagnostic;

      }

      return;

    }

    const transforms = [];

    // Note we iterating backwards so that the character offsets are not

    // invalidated after each substitution.

    for (let i = specifiers.length - 1; i >= 0; i--) {

      const {n: oldSpecifier} = specifiers[i];

      if (oldSpecifier === undefined) {

        // E.g. A dynamic import that's not a static string, like

        // `import(someVariable)`. We can't handle this, skip.

        continue;

      }

      transforms.push({

        info: specifiers[i],

        newSpecifierPromise: this._handleSpecifier(

          oldSpecifier,

          file.file.name,

          getPackageJson,

          output

        ),

      });

    }

    for (const {

      info: {s: start, e: end, n: oldSpecifier, d: dynamicStart},

      newSpecifierPromise,

    } of transforms) {

      let newSpecifier;

      try {

        newSpecifier = await newSpecifierPromise;

      } catch (e) {

        // TODO(aomarks) If this was a TypeScript file, the user isn't going to

        // see this diagnostic, since we're looking at the JS file. To show it

        // correctly on the original file, we'll need source maps support.

        yield {

          kind: 'diagnostic',

          filename: file.file.name,

          diagnostic: {

            message: `Could not resolve module "${oldSpecifier}": ${

              (e as Error).message

            }`,

            range: {

              start: charToLineAndChar(js, start),

              end: charToLineAndChar(js, end),

            },

          },

        };

        continue;

      }

      if (newSpecifier === oldSpecifier) {

        continue;

      }

      // For dynamic imports, the start/end range doesn't include quotes.

      const isDynamic = dynamicStart !== -1;

      const replacement = isDynamic ? `'${newSpecifier}'` : newSpecifier;

      js = js.substring(0, start) + replacement + js.substring(end);

    }

    file.file.content = js;

    yield file;

  }



  /**

   * Transform the given module specifier and process the dependency

   * corresponding to it if needed.

   */

  private async _handleSpecifier(

    specifier: string,

    referrer: string,

    getPackageJson: () => Promise<PackageJson | undefined>,

    output: MergedAsyncIterables<BuildOutput>

  ): Promise<string> {

    const fromImportMap = this._importMapResolver.resolve(specifier);

    if (fromImportMap !== null) {

      return fromImportMap;

    }

    const kind = classifySpecifier(specifier);

    if (kind === 'url') {

      return specifier;

    }

    if (kind === 'bare') {

      return this._handleBareSpecifier(

        specifier,

        referrer,

        getPackageJson,

        output

      );

    }

    // Anything else is a relative specifier.

    if (!referrer.startsWith('node_modules/')) {

      // A relative specifier within a top-level project file. This specifier

      // must resolve to another top-level project file, so there's nothing more

      // we need to do here.

      return specifier;

    }

    // E.g. if `referrer` is "node_modules/foo@1.2.3/a.js" and `specifier` is

    // "./b.js", then `absolute` will be "node_modules/foo@1.2.3/b.js", and

    // `bare` will be "foo@1.2.3/b.js".

    const absolute = resolveUrlPath(referrer, specifier);

    const bare = absolute.slice('/node_modules/'.length);

    if (!fileExtension(specifier)) {

      // We can't simply return the existing relative specifier if there's no

      // ".js" extension, because we still need to do path canonicalization. For

      // example: "./foo" could refer to "./foo.js" or "./foo/index.js"

      // depending on what files are published to this package. We need to

      // consult the CDN to figure that out.

      return this._handleBareSpecifier(

        bare,

        referrer,

        // Note we never need a package.json here, because the version is

        // already included in the specifier itself at this point. We also

        // wouldn't want to pass this scope's `getPackageJson`, because it would

        // be the wrong one.

        async () => undefined,

        output

      );

    }

    // This relative specifier is good as-is, since it has an extension. We just

    // need to fetch it.

    const parsed = parseNpmStyleSpecifier(bare);

    if (parsed === undefined) {

      throw new Error(`Invalid specifier "${bare}"`);

    }

    output.add(this._fetchExternalDependency(parsed, output));

    return specifier;

  }



  /**

   * Canonicalize the given bare module specifier, then fetch it and add it to

   * the local filesystem.

   */

  private async _handleBareSpecifier(

    specifier: string,

    referrer: string,

    getPackageJson: () => Promise<PackageJson | undefined>,

    output: MergedAsyncIterables<BuildOutput>

  ): Promise<string> {

    let location = parseNpmStyleSpecifier(specifier);

    if (location === undefined) {

      throw new Error(`Invalid specifier "${specifier}"`);

    }

    if (!location.version) {

      location.version =

        (await getPackageJson())?.dependencies?.[location.pkg] ?? 'latest';

    }

    // Resolve the version number before resolving the module, so that any error

    // messages generated by the NodeModuleResolver will contain a concrete

    // version number.

    location.version = await this._cdn.resolveVersion(location);

    const packageJson = await this._cdn.fetchPackageJson(location);

    location.path = this._nodeResolver.resolve(location, packageJson, referrer);

    if (!fileExtension(location.path)) {

      // TODO(aomarks) It's safe to use unpkg's redirection-based

      // canonicalization for this final file-extension-adding step ("./foo" ->

      // "./foo.js"), because we've already applied package exports remappings

      // (if we did this in reverse order, unpkg could give us a 404 for a file

      // that only exists as a package export). However, it would be safer and a

      // better separation of concerns to move this final file-extension-adding

      // step directly into the NodeResolver class.

      location = await this._cdn.canonicalize(location);

    }

    output.add(this._fetchExternalDependency(location, output));

    const absolute = `node_modules/${location.pkg}@${location.version}/${location.path}`;

    const relative = relativeUrlPath(referrer, absolute);

    return relative;

  }



  /**

   * Fetch the given external module, and add it to the local filesystem under

   * its "node_modules/" path.

   */

  private async *_fetchExternalDependency(

    location: NpmFileLocation,

    output: MergedAsyncIterables<BuildOutput>

  ) {

    const path = `${location.pkg}@${location.version}/${location.path}`;

    if (this._emittedExternalDependencies.has(path)) {

      // We already emitted this dependency. Avoid import loops and wasteful

      // double fetches.

      return;

    }

    this._emittedExternalDependencies.add(path);

    let asset;

    try {

      asset = await this._cdn.fetch(location);

    } catch (e) {

      // TODO(aomarks) This file will end up as a 404 error when fetched from

      // the preview iframe, because we're simply omitting this file from our

      // output on error. We should instead allow FileBuildOutput to carry an

      // HTTP status code, so then we could propagate this specific error to be

      // served by the service worker, so that it shows up more usefully in the

      // network tab.

      console.error(`Error fetching ${path} from CDN: ${(e as Error).message}`);

      return;

    }

    let packageJson: PackageJson | undefined | null = null;

    const getPackageJson = async (): Promise<PackageJson | undefined> => {

      if (packageJson === null) {

        try {

          packageJson = await this._cdn.fetchPackageJson(location);

        } catch {

          packageJson = undefined;

        }

      }

      return packageJson;

    };

    yield* this._handleModule(

      {

        kind: 'file',

        file: {

          name: `node_modules/${path}`,

          content: asset.content,

          contentType: asset.contentType,

        },

      },

      getPackageJson,

      output

    );

  }

}



/**

 * Create a useful Playground diagnostic from an es-module-lexer exception.

 */

const makeEsModuleLexerDiagnostic = (

  e: Error,

  filename: string

): DiagnosticBuildOutput | undefined => {

  const match = e.message.match(/@:(\d+):(\d+)$/);

  if (match === null) {

    return undefined;

  }

  const line = Number(match[1]) - 1;

  const character = Number(match[2]) - 1;

  return {

    kind: 'diagnostic',

    filename,

    diagnostic: {

      message: `es-module-lexer error: ${e.message}`,

      range: {

        start: {line, character},

        end: {line, character: character + 1},

      },

    },

  };

};



/**

 * Create a useful Playground diagnostic from a JSON.parse exception.

 */

const makeJsonParseDiagnostic = (

  e: Error,

  file: SampleFile

): DiagnosticBuildOutput => {

  const start = extractPositionFromJsonParseError(e.message, file.content) ?? {

    line: 0,

    character: 0,

  };

  return {

    kind: 'diagnostic',

    filename: file.name,

    diagnostic: {

      message: `Invalid package.json: ${e}`,

      range: {

        start,

        // To the rest of the file.

        end: charToLineAndChar(file.content, file.content.length),

      },

    },

  };

};



/**

 * Try to extract the line and character from a `JSON.parse` exception message.

 *

 * Chrome and Firefox often include this information, but using different

 * formats. Safari never includes this information.

 */

const extractPositionFromJsonParseError = (

  message: string,

  json: string

): {line: number; character: number} | undefined => {

  const chrome = message.match(/at position (\d+)/);

  if (chrome !== null) {

    return charToLineAndChar(json, Number(chrome[1]));

  }

  const firefox = message.match(/at line (\d+) column (\d+)/);

  if (firefox !== null) {

    return {

      line: Number(firefox[1]) - 1,

      character: Number(firefox[2]) - 1,

    };

  }

  return undefined;

};

```



build.ts

```

/**

 * @license

 * Copyright 2021 Google LLC

 * SPDX-License-Identifier: BSD-3-Clause

 */



import {BareModuleTransformer} from './bare-module-transformer.js';



import {SampleFile, BuildOutput, WorkerConfig} from '../shared/worker-api.js';

import {getWorkerContext} from './worker-context.js';

import {processTypeScriptFiles} from './typescript-builder.js';



export const build = async (

  files: Array<SampleFile>,

  config: WorkerConfig,

  emit: (result: BuildOutput) => void

): Promise<void> => {

  const workerContext = getWorkerContext(config);

  const bareModuleBuilder = new BareModuleTransformer(

    workerContext.cdn,

    workerContext.importMapResolver

  );



  const results = bareModuleBuilder.process(

    processTypeScriptFiles(

      workerContext,

      files.map((file) => ({kind: 'file', file}))

    )

  );

  for await (const result of results) {

    emit(result);

  }

  emit({kind: 'done'});

};

```



caching-cdn.ts

```

/**

 * @license

 * Copyright 2021 Google LLC

 * SPDX-License-Identifier: BSD-3-Clause

 */



import {

  fileExtension,

  parseNpmStyleSpecifier,

  isExactSemverVersion,

  pkgVersion,

  pkgVersionPath,

} from './util.js';

import {Deferred} from '../shared/deferred.js';



import {NpmFileLocation, PackageJson} from './util.js';



export interface CdnFile {

  content: string;

  contentType: string;

}



/**

 * An interface to unpkg.com or a similar NPM CDN service.

 */

export class CachingCdn {

  private readonly _urlPrefix: string;



  /** A cache for all fetches. */

  private readonly _fetchCache = new Map<

    string,

    Deferred<{url: string; file: CdnFile}>

  >();



  /**

   * Maps from package + version ranges/tags to resolved semver versions. This

   * allows us to canonicalize more efficiently, because once we've resolved

   * e.g. "foo@^1.0.0/foo.js" to "foo@1.2.3/foo.js", we can then canonicalize

   * "foo@^1.0.0/bar.js" without another fetch.

   */

  private readonly _versionCache = new Map<string, string>();



  /**

   * @param urlPrefix E.g. https://unpkg.com/

   */

  constructor(urlPrefix: string) {

    this._urlPrefix = urlPrefix;

  }



  /**

   * Fetch a file from the CDN.

   */

  async fetch(location: NpmFileLocation): Promise<CdnFile> {

    const {file} = await this._fetch(location);

    return file;

  }



  /**

   * Return a version of the given CDN file specifier where version ranges and

   * NPM tags are resolved to concrete semver versions, and ambiguous paths are

   * resolved to concrete ones.

   *

   * E.g. foo@^1.0.0 -> foo@1.2.3/index.js

   *

   * TODO(aomarks) Remove this method in favor of separate resolveVersion and

   * fileExists methods, so that the caller can fully control resolution. We

   * shouldn't rely on unpkg's redirection logic for resolving paths anymore,

   * because it doesn't follow Node package exports, which can arbitrary remap

   * paths.

   */

  async canonicalize(location: NpmFileLocation): Promise<NpmFileLocation> {

    let exact = isExactSemverVersion(location.version);

    if (!exact) {

      const pv = pkgVersion(location);

      const resolved = this._versionCache.get(pv);

      if (resolved !== undefined) {

        location = {...location, version: resolved};

        exact = true;

      }

    }

    if (!exact || fileExtension(location.path) === '') {

      const {url} = await this._fetch(location);

      location = this._parseUnpkgUrl(url);

    }

    return location;

  }



  /**

   * Resolve the concrete version of the given package and version range

   */

  async resolveVersion({

    pkg,

    version,

  }: {

    pkg: string;

    version: string;

  }): Promise<string> {

    return (await this.canonicalize({pkg, version, path: 'package.json'}))

      .version;

  }



  /**

   * Fetch and parse a package's package.json file.

   */

  async fetchPackageJson({

    pkg,

    version,

  }: {

    pkg: string;

    version: string;

  }): Promise<PackageJson> {

    const {

      url,

      file: {content},

    } = await this._fetch({pkg, version, path: 'package.json'});

    try {

      return JSON.parse(content) as PackageJson;

    } catch (e) {

      throw new Error(`Error parsing CDN package.json from ${url}: ${e}`);

    }

  }



  private async _fetch(

    location: NpmFileLocation

  ): Promise<{url: string; file: CdnFile}> {

    let exact = isExactSemverVersion(location.version);

    if (!exact) {

      const pv = pkgVersion(location);

      const resolved = this._versionCache.get(pv);

      if (resolved !== undefined) {

        location = {...location, version: resolved};

        exact = true;

      }

    }

    const pvp = pkgVersionPath(location);

    const cached = this._fetchCache.get(pvp);

    if (cached !== undefined) {

      return cached.promise;

    }

    const deferred = new Deferred<{

      url: string;

      file: {content: string; contentType: string};

    }>();

    this._fetchCache.set(pvp, deferred);

    const url = this._urlPrefix + pvp;

    const res = await fetch(url);

    const content = await res.text();

    if (res.status !== 200) {

      const err = new Error(

        `CDN HTTP ${res.status} error (${url}): ${content}`

      );

      deferred.reject(err);

      return deferred.promise;

    }

    if (!exact) {

      const canonical = this._parseUnpkgUrl(res.url);

      this._versionCache.set(pkgVersion(location), canonical.version);

      this._fetchCache.set(pkgVersionPath(canonical), deferred);

    }

    const result = {

      url: res.url,

      file: {

        content,

        contentType: res.headers.get('content-type') ?? 'text/plain',

      },

    };

    deferred.resolve(result);

    return deferred.promise;

  }



  private _parseUnpkgUrl(url: string): NpmFileLocation {

    if (url.startsWith(this._urlPrefix)) {

      const parsed = parseNpmStyleSpecifier(url.slice(this._urlPrefix.length));

      if (parsed !== undefined) {

        return parsed;

      }

    }

    throw new Error(`Unexpected CDN URL format: ${url}`);

  }

}

```

completions.ts

```

/**

 * @license

 * Copyright 2021 Google LLC

 * SPDX-License-Identifier: BSD-3-Clause

 */



import {

  CompletionInfo,

  GetCompletionsAtPositionOptions,

  SymbolDisplayPart,

  WithMetadata,

} from 'typescript';

import {EditorCompletionDetails, WorkerConfig} from '../shared/worker-api.js';

import {getWorkerContext} from './worker-context.js';



/**

 * Query completions from the Language Service, and sort them by

 * relevance for user to use.

 */

export const queryCompletions = async (

  filename: string,

  fileContent: string,

  tokenUnderCursor: string,

  cursorIndex: number,

  config: WorkerConfig

): Promise<WithMetadata<CompletionInfo> | undefined> => {

  const workerContext = getWorkerContext(config);



  const languageService = workerContext.languageServiceContext.service;

  const languageServiceHost = workerContext.languageServiceContext.serviceHost;

  const searchWordIsPeriod = tokenUnderCursor === '.';



  const options = {} as GetCompletionsAtPositionOptions;

  if (searchWordIsPeriod) {

    options.triggerCharacter = '.';

  }

  // Update language service status so that the file is up to date

  const fileAbsolutePath = new URL(filename, self.origin).href;

  // TODO: Could this cause a race condition between the build phase

  // and the completion phase, and could that be a problem?

  languageServiceHost.updateFileContentIfNeeded(fileAbsolutePath, fileContent);



  // Fetch the collection of completions, the language service offers us for our current context.

  // This list of completions is quite vast, and therefore we will need to do some extra sorting

  // and filtering on it before sending it back to the browser.

  const completions = languageService.getCompletionsAtPosition(

    filename,

    cursorIndex,

    options

  );



  return completions;

};



/**

 * Acquire extra information on the hovered completion item.

 * This includes some package info, context and signatures.

 *

 * This is done separate from acquiring completions, since it's slower, and

 * is done on a per completion basis.

 */

export const getCompletionItemDetails = async (

  filename: string,

  cursorIndex: number,

  config: WorkerConfig,

  completionWord: string

): Promise<EditorCompletionDetails> => {

  const workerContext = getWorkerContext(config);

  const languageService = workerContext.languageServiceContext.service;



  // Only passing relevant params for now, since the other values

  // are not needed for current functionality

  const details = languageService.getCompletionEntryDetails(

    filename,

    cursorIndex,

    completionWord,

    undefined,

    undefined,

    undefined,

    undefined

  );



  const detailInformation: EditorCompletionDetails = {

    text: displayPartsToString(details?.displayParts),

    tags: details?.tags ?? [],

    documentation: getDocumentations(details?.documentation),

  };

  return detailInformation;

};



function displayPartsToString(

  displayParts: SymbolDisplayPart[] | undefined

): string {

  if (!displayParts || displayParts.length === 0) return '';



  let displayString = '';

  displayParts.forEach((part) => {

    displayString += part.text;

  });

  return displayString;

}



function getDocumentations(

  documentation: SymbolDisplayPart[] | undefined

): string[] {

  return documentation?.map((doc) => doc.text) ?? [];

}

```



diagnostic.ts

```

/**

 * @license

 * Copyright 2021 Google LLC

 * SPDX-License-Identifier: BSD-3-Clause

 */



import ts from '../internal/typescript.js';

import * as lsp from 'vscode-languageserver-protocol';



/**

 * Convert a diagnostic from TypeScript format to Language Server Protocol

 * format.

 */

export function makeLspDiagnostic(tsDiagnostic: ts.Diagnostic): lsp.Diagnostic {

  return {

    code: tsDiagnostic.code,

    source: tsDiagnostic.source ?? 'typescript',

    message: ts.flattenDiagnosticMessageText(tsDiagnostic.messageText, '\n'),

    severity: diagnosticCategoryMapping[tsDiagnostic.category],

    range: {

      start:

        tsDiagnostic.file !== undefined && tsDiagnostic.start !== undefined

          ? tsDiagnostic.file.getLineAndCharacterOfPosition(tsDiagnostic.start)

          : {character: 0, line: 0},

      end:

        tsDiagnostic.file !== undefined &&

        tsDiagnostic.start !== undefined &&

        tsDiagnostic.length !== undefined

          ? tsDiagnostic.file.getLineAndCharacterOfPosition(

              tsDiagnostic.start + tsDiagnostic.length

            )

          : {character: 0, line: 0},

    },

  };

}



/**

 * We don't want a runtime import of 'vscode-languageserver-protocol' just for the

 * DiagnosticSeverity constants. We can duplicate the values instead, and assert

 * we got them right with a type constraint.

 */

const diagnosticCategoryMapping: {

  [ts.DiagnosticCategory.Error]: (typeof lsp.DiagnosticSeverity)['Error'];

  [ts.DiagnosticCategory.Warning]: (typeof lsp.DiagnosticSeverity)['Warning'];

  [ts.DiagnosticCategory

    .Message]: (typeof lsp.DiagnosticSeverity)['Information'];

  [ts.DiagnosticCategory.Suggestion]: (typeof lsp.DiagnosticSeverity)['Hint'];

} = {

  [ts.DiagnosticCategory.Error]: 1,

  [ts.DiagnosticCategory.Warning]: 2,

  [ts.DiagnosticCategory.Message]: 3,

  [ts.DiagnosticCategory.Suggestion]: 4,

};

```



import-map-resolver.ts

```

/**

 * @license

 * Copyright 2021 Google LLC

 * SPDX-License-Identifier: BSD-3-Clause

 */



import {ModuleImportMap} from '../shared/worker-api.js';



/**

 * Resolves module specifiers using an import map.

 *

 * For overview, see https://github.com/WICG/import-maps. For algorithm, see

 * https://wicg.github.io/import-maps/#resolving

 *

 * TODO(aomarks) Add support for `scopes`.

 */

export class ImportMapResolver {

  private importMap: ModuleImportMap;



  constructor(importMap: ModuleImportMap) {

    this.importMap = importMap;

  }



  resolve(specifier: string): string | null {

    for (const [specifierKey, resolutionResult] of Object.entries(

      this.importMap.imports ?? {}

    )) {

      // Note that per spec we shouldn't do a lookup for the exact match case,

      // because if a trailing-slash mapping also matches and comes first, it

      // should have precedence.

      if (specifierKey === specifier) {

        return resolutionResult;

      }



      if (specifierKey.endsWith('/') && specifier.startsWith(specifierKey)) {

        if (!resolutionResult.endsWith('/')) {

          console.warn(

            `Could not resolve module specifier "${specifier}"` +

              ` using import map key "${specifierKey}" because` +

              ` address "${resolutionResult}" must end in a forward-slash.`

          );

          return null;

        }



        const afterPrefix = specifier.substring(specifierKey.length);

        let url;

        try {

          url = new URL(afterPrefix, resolutionResult);

        } catch {

          console.warn(

            `Could not resolve module specifier "${specifier}"` +

              ` using import map key "${specifierKey}" because` +

              ` "${afterPrefix}" could not be parsed` +

              ` relative to "${resolutionResult}".`

          );

          return null;

        }



        const urlSerialized = url.href;

        if (!urlSerialized.startsWith(resolutionResult)) {

          console.warn(

            `Could not resolve module specifier "${specifier}"` +

              ` using import map key "${specifierKey}" because` +

              ` "${afterPrefix}" backtracked above "${resolutionResult}".`

          );

          return null;

        }

        return urlSerialized;

      }

    }

    return null;

  }

}

```

language-service-context.ts

```

/**

 * @license

 * Copyright 2021 Google LLC

 * SPDX-License-Identifier: BSD-3-Clause

 */



import ts from '../internal/typescript.js';



const compilerOptions = {

  target: ts.ScriptTarget.ES2021,

  module: ts.ModuleKind.ESNext,

  experimentalDecorators: true,

  skipDefaultLibCheck: true,

  skipLibCheck: true,

  allowJs: true,

  moduleResolution: ts.ModuleResolutionKind.NodeNext,

  jsx: ts.JsxEmit.React,

  lib: ['dom', 'esnext'],

};



/**

 * Compiles a project, returning a Map of compiled file contents. The map only

 * contains context for files that are compiled. Other files are skipped.

 *

 * TODO (justinfagnani):  We could share a DocumentRegistry across

 * multiple <playground-project> instances to save memory and type analysis of

 * common lib files like lit-element, lib.d.ts and dom.d.ts.

 */

export class LanguageServiceContext {

  readonly compilerOptions = compilerOptions;



  readonly serviceHost = new WorkerLanguageServiceHost(

    self.origin,

    compilerOptions

  );



  readonly service = ts.createLanguageService(

    this.serviceHost,

    ts.createDocumentRegistry()

  );

}



interface VersionedFile {

  version: number;

  content: string;

}



class WorkerLanguageServiceHost implements ts.LanguageServiceHost {

  readonly compilerOptions: ts.CompilerOptions;

  readonly packageRoot: string;

  readonly files: Map<string, VersionedFile> = new Map<string, VersionedFile>();



  constructor(packageRoot: string, compilerOptions: ts.CompilerOptions) {

    this.packageRoot = packageRoot;

    this.compilerOptions = compilerOptions;

  }



  /*

   *  When a new new "process" command is received, we iterate through all of the files,

   *  and update files accordingly depending on if they have new content or not.

   *

   *  With how the TS API works, we can use simple versioning to tell the

   *  Language service that a file has been updated

   *

   *  If the file submitted is a new file, we add it to our collection

   */

  updateFileContentIfNeeded(fileName: string, content: string) {

    const file = this.files.get(fileName);

    if (file && file.content !== content) {

      file.content = content;

      file.version += 1;

    } else {

      this.files.set(fileName, {content, version: 0});

    }

  }



  /**

   * Sync up the freshly acquired project files.

   * In the syncing process files yet to be added are added, and versioned.

   * Files that existed already but are modified are updated, and their version number

   * gets bumped fo that the languageservice knows to update these files.

   * */

  sync(files: Map<string, string>) {

    files.forEach((file, fileName) =>

      this.updateFileContentIfNeeded(fileName, file)

    );

    this._removeDeletedFiles(files);

  }



  private _removeDeletedFiles(files: Map<string, string>) {

    this.getScriptFileNames().forEach((fileName) => {

      // Do not delete the dependency files, as then they will get re-applied every compilation.

      // This is because the compilation step is aware of these files, but the completion step isn't.

      if (!fileName.includes('node_modules') && !files.has(fileName)) {

        this.files.delete(fileName);

      }

    });

  }



  getCompilationSettings(): ts.CompilerOptions {

    return this.compilerOptions;

  }



  getScriptFileNames(): string[] {

    return [...this.files.keys()];

  }



  getScriptVersion(fileName: string) {

    return this.files.get(fileName)?.version.toString() ?? '-1';

  }



  fileExists(fileName: string): boolean {

    return this.files.has(fileName);

  }



  readFile(fileName: string): string | undefined {

    return this.files.get(fileName)?.content;

  }



  getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {

    if (!this.fileExists(fileName)) {

      return undefined;

    }

    return ts.ScriptSnapshot.fromString(this.readFile(fileName)!);

  }



  getCurrentDirectory(): string {

    return this.packageRoot;

  }



  getDefaultLibFileName(): string {

    return '__lib.d.ts';

  }

}

```



node-module-resolver.ts

```

/**

 * @license

 * Copyright 2021 Google LLC

 * SPDX-License-Identifier: BSD-3-Clause

 */



import {packageExportsResolve} from './node/resolve.js';

import {NpmFileLocation, PackageJson, PackageJsonWithExports} from './util.js';



/**

 * Resolves a path according to the Node package exports algorithm.

 *

 * Documentation:

 *

 *   Node: https://nodejs.org/api/packages.html#packages_package_entry_points

 *   Rollup: https://github.com/rollup/plugins/tree/master/packages/node-resolve/#package-entrypoints

 *   Webpack: https://webpack.js.org/guides/package-exports/

 *

 * Reference implementations:

 *

 *   Node: https://github.com/nodejs/node/blob/a9dd03b1ec89a75186f05967fc76ec0704050c36/lib/internal/modules/esm/resolve.js#L615

 *   Rollup:

 * https://github.com/rollup/plugins/blob/53fb18c0c2852598200c547a0b1d745d15b5b487/packages/node-resolve/src/package/resolvePackageImportsExports.js#L6

 */

export class NodeModuleResolver {

  private readonly _conditions: Set<string>;



  constructor({conditions}: {conditions: string[]}) {

    this._conditions = new Set(conditions);

  }



  /**

   * @param location Package/version/path to resolve.

   * @param packageJson The package's package.json (parsed object, not string).

   * @param base Path of the importing module, used for error messages (e.g.

   * "./my-element.js").

   * @return The resolved subpath.

   * @throws If the given subpath could not be resolved.

   */

  resolve(

    location: NpmFileLocation,

    packageJson: PackageJson,

    base: string

  ): string {

    const packageSubpath = addRelativePrefix(location.path);



    if (packageJson.exports === undefined) {

      if (packageSubpath === '.') {

        if (packageJson.module !== undefined) {

          return removeRelativePrefix(packageJson.module);

        }

        if (packageJson.main !== undefined) {

          return removeRelativePrefix(packageJson.main);

        }

        return 'index.js';

      }

      return location.path;

    }



    // Node's resolve functions works with file:// URLs. It doesn't really

    // matter what we use as the base, but let's make one that matches the

    // Playground URL space for dependencies, so that errors make sense.

    const packageBase = `/node_modules/${location.pkg}@${location.version}/`;

    const packageJsonUrl = new URL(packageBase, 'file://');



    const resolved = packageExportsResolve(

      packageJsonUrl,

      packageSubpath,

      packageJson as PackageJsonWithExports,

      base,

      this._conditions

    );

    if (!resolved.pathname.startsWith(packageBase)) {

      throw new Error(

        `Unexpected error: ${resolved.pathname} expected to start with ${packageBase}`

      );

    }

    return resolved.pathname.slice(packageBase.length);

  }

}



/**

 * Convert e.g. "" to "." and "foo.js" to "./foo.js".

 */

const addRelativePrefix = (path: string): string => {

  if (path === '') {

    return '.';

  }

  if (!path.startsWith('.') && !path.startsWith('/')) {

    return './' + path;

  }

  return path;

};



/**

 * Convert e.g. "." to "" and "./foo.js" to "foo.js".

 */

const removeRelativePrefix = (path: string): string => {

  if (path === '.') {

    return '';

  }

  if (path.startsWith('./')) {

    return path.slice(2);

  }

  return path;

};

```

types-fetcher.ts

```

/**

 * @license

 * Copyright 2021 Google LLC

 * SPDX-License-Identifier: BSD-3-Clause

 */



import ts from '../internal/typescript.js';

import {ImportMapResolver} from './import-map-resolver.js';

import {Deferred} from '../shared/deferred.js';

import {

  parseNpmStyleSpecifier,

  changeFileExtension,

  classifySpecifier,

  resolveUrlPath,

  trimTrailingSlash,

  trimLeadingSlash,

} from './util.js';



import {Result} from '../shared/util.js';

import {CachingCdn} from './caching-cdn.js';

import {PackageJson, NpmFileLocation} from './util.js';

import {

  PackageDependencies,

  DependencyGraph,

  NodeModulesDirectory,

  NodeModulesLayoutMaker,

} from './node-modules-layout-maker.js';



type PackageName = string;

type PackageVersion = string;

type FilePath = string;

type FileContent = string;



/**

 * The top-level project. Used as a referrer.

 */

const root = Symbol();



/**

 * Fetches typings for TypeScript imports and their transitive dependencies, and

 * for standard libraries.

 */

export class TypesFetcher {

  private readonly _cdn: CachingCdn;

  private readonly _importMapResolver: ImportMapResolver;

  private readonly _rootPackageJson: PackageJson | undefined;



  private readonly _rootDependencies: PackageDependencies = {};

  private readonly _dependencyGraph: DependencyGraph = {};

  private readonly _filesByPackageVersion = new Map<

    PackageName,

    Map<PackageVersion, Map<FilePath, Promise<Result<FileContent, number>>>>

  >();



  /**

   * Fetch all ".d.ts" typing files for the full transitive dependency tree of

   * the given project source files and standard libs.

   *

   * @param cdn Interface to unpkg.com or similar CDN service for fetching

   * assets.

   * @param importMapResolver Resolves bare modules to custom URLs, for

   * optionally overriding the CDN.

   * @param rootPackageJson The parsed package.json file for the root project,

   * or undefined if there isn't one.

   * @param sources Project TypeScript source file contents. All bare module

   * imports in these sources will be followed.

   * @param tsLibs Case-insensitive TypeScript standard libraries to fetch, e.g.

   * "es2020", "DOM".

   */

  static async fetchTypes(

    cdn: CachingCdn,

    importMapResolver: ImportMapResolver,

    rootPackageJson: PackageJson | undefined,

    sources: string[],

    tsLibs: string[]

  ): Promise<{

    files: Map<FilePath, FileContent>;

    layout: NodeModulesDirectory;

    dependencyGraph: {

      root: PackageDependencies;

      deps: DependencyGraph;

    };

  }> {

    const fetcher = new TypesFetcher(cdn, importMapResolver, rootPackageJson);

    // Note we use Promise.allSettled instead of Promise.all because we really

    // do want to ignore exceptions due to 404s etc., and don't want one error

    // to fail the entire tree. If the .d.ts files for an import fail to load

    // for any reason, then they won't exist in the virtual filesystem passed to

    // TypeScript, and the user will therefore see a "missing types" error. An

    // improvement would be to surface some more detail to the user, though,

    // especially for non-404 errors.

    await Promise.allSettled([

      ...sources.map((source) =>

        fetcher._handleBareAndRelativeSpecifiers(source, root)

      ),

      ...tsLibs.map((lib) => fetcher._addTypeScriptStandardLib(lib)),

      fetcher._fetchTypesPackages(),

    ]);

    const layout = new NodeModulesLayoutMaker().layout(

      fetcher._rootDependencies,

      fetcher._dependencyGraph

    );

    const files = new Map<string, string>();

    await fetcher._materializeNodeModulesTree(layout, files, '');

    // Note in practice we only really need "files", but it's useful to also

    // return the dependency graph and layout for testing.

    return {

      files,

      layout,

      dependencyGraph: {

        root: fetcher._rootDependencies,

        deps: fetcher._dependencyGraph,

      },

    };

  }



  private constructor(

    cdn: CachingCdn,

    importMapResolver: ImportMapResolver,

    rootPackageJson: PackageJson | undefined

  ) {

    this._cdn = cdn;

    this._importMapResolver = importMapResolver;

    this._rootPackageJson = rootPackageJson;

  }



  private async _fetchTypesPackages(): Promise<void> {

    if (

      this._rootPackageJson === undefined ||

      this._rootPackageJson.dependencies === undefined

    ) {

      return;

    }



    const typesPackages = Object.keys(

      this._rootPackageJson.dependencies

    ).filter((k) => k.startsWith('@types/'));



    if (typesPackages.length === 0) {

      return;

    }



    await Promise.allSettled(

      typesPackages.map((k) => this._handleBareSpecifier(k, root))

    );

  }



  private async _addTypeScriptStandardLib(lib: string): Promise<void> {

    return this._handleBareSpecifier(

      `typescript/lib/lib.${lib.toLowerCase()}.js`,

      root

    );

  }



  private async _handleBareAndRelativeSpecifiers(

    sourceText: string,

    referrer: NpmFileLocation | typeof root

  ): Promise<void> {

    const fileInfo = ts.preProcessFile(sourceText, undefined, true);

    const promises = [];

    for (const {fileName: specifier} of fileInfo.importedFiles) {

      const kind = classifySpecifier(specifier);

      if (kind === 'bare') {

        promises.push(this._handleBareSpecifier(specifier, referrer));

      } else if (kind === 'relative' && referrer !== root) {

        // Note we never need to follow relative imports from project root files

        // because those can only be other project files, which are already

        // being processed, since we pass all project files to this class.

        promises.push(this._handleRelativeSpecifier(specifier, referrer));

      }

    }

    for (const {fileName: lib} of fileInfo.libReferenceDirectives) {

      promises.push(this._addTypeScriptStandardLib(lib));

    }

    await Promise.allSettled(promises);

  }



  private async _handleBareSpecifier(

    bare: string,

    referrer: NpmFileLocation | typeof root

  ): Promise<void> {

    let location = parseNpmStyleSpecifier(bare);

    if (location === undefined) {

      return;

    }

    // Versions don't make much sense with an import map, since you just have

    // bare specifier -> URL. We can leave whatever version we already have; it

    // will always be ignored.

    const handledByImportMap = this._importMapResolver.resolve(bare) !== null;

    // Get the version range based on the referrer's package.json.

    if (!handledByImportMap) {

      location.version = await this._getDependencyVersion(

        referrer,

        location.pkg

      );

    }

    // Get the ".d.ts" path by changing extension, or looking up the "typings"

    // field, etc.

    location.path = await this._getDtsPath(location);

    // Resolve the concrete version.

    if (!handledByImportMap) {

      location = await this._cdn.canonicalize(location);

    }

    if (referrer === root || location.pkg !== referrer.pkg) {

      // Note the two package names can be the same in the case that a typings

      // file imports another module from the same package using its own bare

      // module name, instead of a relative path. TypeScript does support this

      // case, and it does happen (e.g. @material/base does this). We don't need

      // a self-edge in the dependency graph, though.

      this._addEdgeToDependencyGraph(referrer, location);

    }

    // Stop early if we've already handled this specifier.

    if (

      this._filesByPackageVersion

        .get(location.pkg)

        ?.get(location.version)

        ?.get(location.path) !== undefined

    ) {

      return;

    }

    // Ready to fetch and recurse.

    const dtsResult = await this._fetchAndAddToOutputFiles(location);

    if (dtsResult.error !== undefined) {

      return;

    }

    await this._handleBareAndRelativeSpecifiers(dtsResult.result, location);

  }



  private async _handleRelativeSpecifier(

    relative: string,

    referrer: NpmFileLocation

  ): Promise<void> {

    const location = {

      // We know package and version must be the same as the referrer, since

      // this is a relative path, and we are therefore still in the same

      // package.

      pkg: referrer.pkg,

      version: referrer.version,

      // Make the path package-root relative, instead of referrer-path relative.

      path: trimLeadingSlash(resolveUrlPath(referrer.path, relative).slice(1)),

    };

    location.path = changeFileExtension(location.path, 'd.ts');

    // Stop early if we've already handled this specifier.

    if (

      this._filesByPackageVersion

        .get(location.pkg)

        ?.get(location.version)

        ?.get(location.path) !== undefined

    ) {

      return;

    }

    const dtsResult = await this._fetchAndAddToOutputFiles(location);

    if (dtsResult.error !== undefined) {

      return;

    }

    await this._handleBareAndRelativeSpecifiers(dtsResult.result, location);

  }



  private async _getDependencyVersion(

    from: NpmFileLocation | typeof root,

    to: string

  ): Promise<string> {

    const packageJson =

      from === root

        ? this._rootPackageJson

        : await this._fetchPackageJsonAndAddToOutputFiles(from);

    return packageJson?.dependencies?.[to] ?? 'latest';

  }



  private async _getDtsPath(location: NpmFileLocation): Promise<string> {

    if (location.path !== '') {

      return changeFileExtension(location.path, 'd.ts');

    }

    const packageJson = await this._fetchPackageJsonAndAddToOutputFiles(

      location

    );

    return (

      packageJson?.typings ??

      packageJson?.types ??

      (packageJson?.main !== undefined

        ? changeFileExtension(packageJson.main, 'd.ts')

        : undefined) ??

      'index.d.ts'

    );

  }



  private async _fetchPackageJsonAndAddToOutputFiles(location: {

    pkg: string;

    version: string;

  }): Promise<PackageJson> {

    const result = await this._fetchAndAddToOutputFiles({

      ...location,

      path: 'package.json',

    });

    if (result.error !== undefined) {

      throw new Error(

        `Could not fetch package.json for ` +

          `${location.pkg}@${location.version}: ${result.error}`

      );

    }

    return JSON.parse(result.result) as PackageJson;

  }



  private async _fetchAndAddToOutputFiles(

    location: NpmFileLocation

  ): Promise<Result<string, number>> {

    const importMapUrl = this._importMapResolver.resolve(

      trimTrailingSlash(`${location.pkg}/${location.path}`)

    );

    if (importMapUrl === null) {

      location = await this._cdn.canonicalize(location);

    }



    let versions = this._filesByPackageVersion.get(location.pkg);

    if (versions === undefined) {

      versions = new Map();

      this._filesByPackageVersion.set(location.pkg, versions);

    }

    let files = versions.get(location.version);

    if (files === undefined) {

      files = new Map();

      versions.set(location.version, files);

    }

    let promise = files.get(location.path);

    if (promise !== undefined) {

      return promise;

    }

    const deferred = new Deferred<Result<string, number>>();

    promise = deferred.promise;

    files.set(location.path, promise);



    let content;

    if (importMapUrl !== null) {

      const r = await fetch(importMapUrl);

      if (r.status !== 200) {

        const err = {error: r.status};

        deferred.resolve(err);

        return err;

      }

      content = await r.text();

    } else {

      try {

        const r = await this._cdn.fetch(location);

        content = r.content;

      } catch {

        const err = {error: 404};

        deferred.resolve(err);

        return err;

      }

    }

    const result = {result: content};

    deferred.resolve(result);

    return result;

  }



  /**

   * Record in our dependency graph that some package depends on another.

   */

  private _addEdgeToDependencyGraph(

    from: {pkg: string; version: string} | typeof root,

    to: {pkg: string; version: string}

  ) {

    if (from === root) {

      this._rootDependencies[to.pkg] = to.version;

    } else {

      let fromVersions = this._dependencyGraph[from.pkg];

      if (fromVersions === undefined) {

        fromVersions = {};

        this._dependencyGraph[from.pkg] = fromVersions;

      }

      let deps = fromVersions[from.version];

      if (deps === undefined) {

        deps = {};

        fromVersions[from.version] = deps;

      }

      deps[to.pkg] = to.version;

    }

  }



  /**

   * Materialize a node_modules/ file tree for the given layout into the given

   * file map, using the files we've fetched.

   *

   * For example, given the layout ...

   *

   *   ROOT

   *   ├── A1

   *   ├── B1

   *   │   └── A2

   *   └── C1

   *       └── A2

   *

   * ... and where each package just contains one "index.d.ts" file, then

   * populates the file map with keys:

   *

   *   a/index.d.ts

   *   b/index.d.ts

   *   b/node_modules/a/index.d.ts

   *   c/index.d.ts

   *   c/node_modules/a/index.d.ts

   */

  private async _materializeNodeModulesTree(

    layout: NodeModulesDirectory,

    fileMap: Map<FilePath, FileContent>,

    prefix: FilePath

  ): Promise<void> {

    for (const [pkg, entry] of Object.entries(layout)) {

      const files = this._filesByPackageVersion.get(pkg)?.get(entry.version);

      if (files === undefined) {

        continue;

      }

      for (const [pkgRelativePath, promise] of files) {

        const result = await promise;

        if (result.error === undefined) {

          const fullyQualifiedPath = `${prefix}${pkg}/${pkgRelativePath}`;

          fileMap.set(fullyQualifiedPath, result.result);

        }

      }

      await this._materializeNodeModulesTree(

        entry.nodeModules,

        fileMap,

        `${prefix}${pkg}/node_modules/`

      );

    }

  }

}

```

typescript-builder.ts

```

/**

 * @license

 * Copyright 2021 Google LLC

 * SPDX-License-Identifier: BSD-3-Clause

 */



import {BuildOutput, SampleFile} from '../shared/worker-api.js';

import {TypesFetcher} from './types-fetcher.js';

import {PackageJson} from './util.js';

import {makeLspDiagnostic} from './diagnostic.js';

import {WorkerContext} from './worker-context.js';



export async function* processTypeScriptFiles(

  workerContext: WorkerContext,

  results: AsyncIterable<BuildOutput> | Iterable<BuildOutput>

): AsyncIterable<BuildOutput> {

  // Instantiate langservice variables for ease of access

  const langService = workerContext.languageServiceContext.service;

  const langServiceHost = workerContext.languageServiceContext.serviceHost;

  let packageJson: PackageJson | undefined;

  const compilerInputs = [];

  for await (const result of results) {

    if (

      result.kind === 'file' &&

      (result.file.name.endsWith('.ts') ||

        result.file.name.endsWith('.jsx') ||

        result.file.name.endsWith('.tsx'))

    ) {

      compilerInputs.push(result.file);

    } else {

      yield result;

      if (result.kind === 'file' && result.file.name === 'package.json') {

        try {

          packageJson = JSON.parse(result.file.content) as PackageJson;

        } catch (e) {

          // A bit hacky, but BareModuleTransformer already emits a diagnostic

          // for this case, so we don't need another one.

        }

      }

    }

  }



  if (compilerInputs.length === 0) {

    return;

  }



  // Immediately resolve local project files, and begin fetching types (but

  // don't wait for them).

  const loadedFiles = new Map<string, string>();

  const inputFiles = compilerInputs.map((file) => ({

    file,

    url: new URL(file.name, self.origin).href,

  }));



  for (const {file, url} of inputFiles) {

    loadedFiles.set(url, file.content);

  }



  // TypeScript needs the local package.json because it's interested in the

  // "types" and "imports" fields.

  //

  // We also change the default "type" field from "commonjs" to "module" because

  // we're pretty much always in a web context, and wanting standard module

  // semantics.

  const defaultPackageJson =

    packageJson === undefined

      ? {type: 'module'}

      : packageJson.type === 'module'

      ? packageJson

      : {...packageJson, type: 'module'};

  loadedFiles.set(

    new URL('package.json', self.origin).href,

    JSON.stringify(defaultPackageJson)

  );



  // Sync the new loaded files with the servicehost.

  // If the file is missing, it's added, if the file is modified,

  // the modification data and versioning will be handled by the servicehost.

  // If a file is removed, it will be removed from the file list

  langServiceHost.sync(loadedFiles);



  const program = langService.getProgram();

  if (program === undefined) {

    throw new Error('Unexpected error: program was undefined');

  }



  for (const {file, url} of inputFiles) {

    for (const tsDiagnostic of langService.getSyntacticDiagnostics(url)) {

      yield {

        kind: 'diagnostic',

        filename: file.name,

        diagnostic: makeLspDiagnostic(tsDiagnostic),

      };

    }

    const sourceFile = program.getSourceFile(url);

    let compiled: SampleFile | undefined = undefined;

    program!.emit(sourceFile, (url, content) => {

      compiled = {

        name: new URL(url).pathname.slice(1),

        content,

        contentType: 'text/javascript',

      };

    });

    if (compiled !== undefined) {

      yield {kind: 'file', file: compiled};

    }

  }



  // Wait for all typings to be fetched, and then retrieve slower semantic

  // diagnostics.

  const typings = await TypesFetcher.fetchTypes(

    workerContext.cdn,

    workerContext.importMapResolver,

    packageJson,

    inputFiles.map((file) => file.file.content),

    workerContext.languageServiceContext.compilerOptions.lib

  );

  for (const [path, content] of typings.files) {

    // TypeScript is going to look for these files as paths relative to our

    // source files, so we need to add them to our filesystem with those URLs.

    const url = new URL(`node_modules/${path}`, self.origin).href;

    langServiceHost.updateFileContentIfNeeded(url, content);

  }

  for (const {file, url} of inputFiles) {

    for (const tsDiagnostic of langService.getSemanticDiagnostics(url)) {

      yield {

        kind: 'diagnostic',

        filename: file.name,

        diagnostic: makeLspDiagnostic(tsDiagnostic),

      };

    }

  }

}

```

utils.ts

/**

 * @license

 * Copyright 2021 Google LLC

 * SPDX-License-Identifier: BSD-3-Clause

 */



/**

 * Merges multiple async iterables into one iterable. Order is not preserved.

 * Iterables can be added before or during iteration. After exhausted, adding a

 * new iterator throws.

 */

export class MergedAsyncIterables<T> {

  private readonly _buffer: Array<{value: T; emitted: () => void}> = [];

  private _numSources = 0;

  private _notify?: () => void;

  private _done = false;



  async *[Symbol.asyncIterator]() {

    while (this._numSources > 0) {

      while (this._buffer.length > 0) {

        const {value, emitted} = this._buffer.shift()!;

        yield value;

        // Let the loop in add() continue

        emitted();

      }

      // Wait until there is a new value or a source iterator was exhausted

      await new Promise<void>((resolve) => (this._notify = resolve));

      this._notify = undefined;

    }

    this._done = true;

  }



  add(iterable: AsyncIterable<T>) {

    if (this._done) {

      throw new Error(

        'Merged iterator is exhausted. Cannot add new source iterators.'

      );

    }

    this._numSources++;

    void (async () => {

      for await (const value of iterable) {

        // Wait for this value to be emitted before continuing

        await new Promise<void>((emitted) => {

          this._buffer.push({value, emitted});

          this._notify?.();

        });

      }

      this._numSources--;

      this._notify?.();

    })();

  }

}



/**

 * Return the relative path from two URL pathnames.

 *

 * E.g. given "a/b/c.js" and "a/d.js" return "../d.js".

 */

export const relativeUrlPath = (from: string, to: string): string => {

  const fromParts = from.split('/');

  const toParts = to.split('/');

  let numCommon = 0;

  while (

    numCommon < fromParts.length &&

    numCommon < toParts.length &&

    fromParts[numCommon] === toParts[numCommon]

  ) {

    numCommon++;

  }

  const numUp = fromParts.length - numCommon - 1;

  return (

    (numUp === 0 ? './' : new Array(numUp + 1).join('../')) +

    toParts.slice(numCommon).join('/')

  );

};



/**

 * Resolve two URL pathnames into an absolute path.

 *

 * E.g. given "a/b/c.js" and "../d.js" return "a/d.js".

 */

export const resolveUrlPath = (a: string, b: string) =>

  // The base URL is arbitrary and "ws://_" is very short.

  new URL(b, new URL(a, 'ws://_')).pathname;



/**

 * Return whether the given module import specifier is bare, a relative URL, or

 * a fully qualified URL.

 */

export const classifySpecifier = (

  specifier: string

): 'bare' | 'relative' | 'url' => {

  try {

    // Note a specifier like "te:st.js" would be classified as a URL. This is

    // ok, because we can assume bare specifiers are always prefixed with a NPM

    // package name, which cannot contain ":" characters.

    new URL(specifier).href;

    return 'url';

    // eslint-disable-next-line no-empty

  } catch {}

  if (specifier.match(/^(\.){0,2}\//) !== null) {

    return 'relative';

  }

  return 'bare';

};



export interface NpmFileLocation {

  pkg: string;

  version: string;

  path: string;

}



/**

 * Parse the given module import specifier using format

 * "<pkg>[@<version>][/<path>]".

 *

 * E.g. given "foo@^1.2.3/bar.js" return {

 *   pkg: "foo",

 *   version: "^1.2.3",

 *   path: "bar.js"

 * }

 */

export const parseNpmStyleSpecifier = (

  specifier: string

): NpmFileLocation | undefined => {

  const match = specifier.match(/^((?:@[^/@]+\/)?[^/@]+)(?:@([^/]+))?\/?(.*)$/);

  if (match === null) {

    return undefined;

  }

  const [, pkg, version, path] = match as [

    unknown,

    string,

    string | undefined,

    string

  ];

  return {pkg, version: version ?? '', path};

};



/**

 * Return the file extension of the given URL path. Does not include the leading

 * ".". Note this only considers the final ".", so e.g. given "foo.d.ts" this

 * will return "ts".

 */

export const fileExtension = (path: string): string => {

  const lastSlashIdx = path.lastIndexOf('/');

  const lastDotIdx = path.lastIndexOf('.');

  return lastDotIdx === -1 || lastDotIdx < lastSlashIdx

    ? ''

    : path.slice(lastDotIdx + 1);

};



/**

 * Change the given URL path's file extension to a different one. `newExt`

 * should not include the leading ".". Note this only considers the final ".",

 * so e.g. given "foo.d.ts" and ".js" this will return "foo.d.js".

 */

export const changeFileExtension = (path: string, newExt: string): string => {

  const oldExt = fileExtension(path);

  if (oldExt === '') {

    return path + '.' + newExt;

  }

  return path.slice(0, -oldExt.length) + newExt;

};



/**

 * Given a string and string-relative character index, return the equivalent

 * line number and line-relative character index.

 */

export const charToLineAndChar = (

  str: string,

  char: number

): {line: number; character: number} => {

  let line = 0;

  let character = 0;

  for (let i = 0; i < char && i < str.length; i++) {

    if (str[i] === '\n') {

      line++;

      character = 0;

    } else {

      character++;

    }

  }

  return {line, character};

};



/**

 * The "exports" field of a package.json.

 *

 * See https://nodejs.org/api/packages.html#packages_exports.

 */

export type PackageExports =

  | PackageExportsTarget

  | PackageExportsPathOrConditionMap;



/**

 * The export result for some path or condition.

 */

export type PackageExportsTarget =

  // A concrete path.

  | PackageExportsTargetPath

  // Condition maps can be nested.

  | PackageExportsConditionMap

  // The first valid target in an array wins.

  | PackageExportsTarget[]

  // An explicit "not found".

  | null;



/**

 * A concrete resolved path (e.g. "./lib/foo.js").

 */

export type PackageExportsTargetPath = string;



/**

 * Map from a path or condition to a target.

 */

export type PackageExportsPathOrConditionMap = {

  [pathOrCondition: string]: PackageExportsTarget;

};



/**

 * Map from a condition to a target.

 *

 * Note this is technically the same type as PackageExportsPathOrConditionMap,

 * but it's distinguished for clarity because "path" keys are only allowed in

 * the top-level of the "exports" object.

 */

export type PackageExportsConditionMap = {

  [condition: string]: PackageExportsTarget;

};



export interface PackageJson {

  version?: string;

  main?: string;

  exports?: PackageExports;

  module?: string;

  types?: string;

  typings?: string;

  type?: string;

  dependencies?: {[key: string]: string};

}



export interface PackageJsonWithExports extends PackageJson {

  exports: PackageExports;

}



/**

 * Return whether the given string is an exact semver version, as opposed to a

 * range or tag.

 */

export const isExactSemverVersion = (s: string) =>

  s.match(

    // https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string

    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

  ) !== null;



export const pkgVersion = ({pkg, version}: {pkg: string; version: string}) =>

  `${pkg}@${version || 'latest'}`;



export const pkgVersionPath = ({pkg, version, path}: NpmFileLocation) =>

  trimTrailingSlash(`${pkgVersion({pkg, version})}/${trimLeadingSlash(path)}`);



export const trimLeadingSlash = (s: string) =>

  s.startsWith('/') ? s.slice(1) : s;



export const trimTrailingSlash = (s: string) =>

  s.endsWith('/') ? s.slice(0, -1) : s;

```



worker-context.ts

```

/**

 * @license

 * Copyright 2021 Google LLC

 * SPDX-License-Identifier: BSD-3-Clause

 */



import {LanguageServiceContext} from './language-service-context.js';

import {CachingCdn} from './caching-cdn.js';

import {ImportMapResolver} from './import-map-resolver.js';

import {WorkerConfig} from '../shared/worker-api.js';



let workerContext: WorkerContext | undefined;

let cacheKey = '';



/**

 * Acquire the existing worker instance, or create a fresh one if missing.

 * If the config differs from the existing instance's config, a new WorkerContext is

 * instantiated and made the new instance.

 */

export function getWorkerContext(config: WorkerConfig) {

  const configCacheKey = JSON.stringify(config);

  if (workerContext && cacheKey === configCacheKey) {

    return workerContext;

  }



  cacheKey = configCacheKey;

  workerContext = new WorkerContext(config);

  return workerContext;

}



export class WorkerContext {

  readonly cdn: CachingCdn;

  readonly importMapResolver: ImportMapResolver;

  readonly languageServiceContext: LanguageServiceContext;



  constructor(config: WorkerConfig) {

    this.importMapResolver = new ImportMapResolver(config.importMap);

    this.cdn = new CachingCdn(config.cdnBaseUrl ?? 'https://unpkg.com/');

    this.languageServiceContext = new LanguageServiceContext();

  }

}

```

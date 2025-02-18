/**
 * A function that returns a number
 */
export function giveMeANumber(): number;

/**
 * A function with overloaded signatures
 */
export function processInput(input: string): string;
/**
 * A function with overloaded signatures
 */
export function processInput(input: number): number;
/**
 * A function with overloaded signatures
 */
export function processInput(input: Person): string;

/**
 * Type alias for a callback function
 */
export type CallbackFn = (value: number) => void;

/**
 * Function that accepts a callback
 * @param callback
 */
export function withCallback(callback: CallbackFn): void;

/**
 * A function that returns a tuple
 */
export function returnTuple(): [string, number];

/**
 * A function that returns a union type
 */
export function returnUnion(): string | number;

/**
 * An enum
 */
export enum Color {
  Red,
  Green,
  Blue,
}

/**
 * A function that uses the enum
 * @param color
 * @returns
 */
export function describeColor(color: Color): string;


/**
 * A function that uses a conditional type
 * @param value
 * @returns
 */
export function nameOrAge(value: string | number): NameOrAge<typeof value>;

/**
 * A conditional type example
 */
export type NameOrAge<T> = T extends string? string: number;

/**
 * A function that takes a rest parameter
 * @param args
 * @returns
 */
export function sum(...args: number): number;

/**
 * A function with optional parameters
 * @param a
 * @param b
 * @param c
 * @returns
 */
export function optionalParams(a: number, b?: string, c?: boolean): number;

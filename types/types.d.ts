/**
 * A function that returns a number
 */
export function giveMeANumber(): number;

/**
 * A function with overloaded signatures
 * @param input The input to process
 * @returns The processed input
 */
export function processInput(input: string): string;
/**
 * A function with overloaded signatures
 * @param input The input to process
 * @returns The processed input
 */
export function processInput(input: number): number;
/**
 * A function with overloaded signatures
 * @param input The input to process
 * @returns The processed input
 */
export function processInput(input: Person): string;

/**
 * Type alias for a callback function
 */
export type CallbackFn = (value: number) => void;

/**
 * Function that accepts a callback
 * @param callback The callback function
 */
export function withCallback(callback: CallbackFn): void;

/**
 * A function that returns a tuple
 * @returns A tuple containing a string and a number
 */
export function returnTuple(): [string, number];

/**
 * A function that returns a union type
 * @returns A string or a number
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
 * @param color The color to describe
 * @returns A description of the color
 */
export function describeColor(color: Color): string;

/**
 * A conditional type example
 */
export type NameOrAge<T> = T extends string? string: number;

/**
 * A function that uses a conditional type
 * @param value The value to check
 * @returns The name or age of the value
 */
export function nameOrAge(value: string | number): NameOrAge<typeof value>;

/**
 * A function that takes a rest parameter
 * @param args The numbers to sum
 * @returns The sum of the numbers
 */
export function sum(...args: number): number;

/**
 * A function with optional parameters
 * @param a The first number
 * @param b The second number (optional)
 * @param c The third number (optional)
 * @returns The sum of the numbers
 */
export function optionalParams(a: number, b?: string, c?: boolean): number;

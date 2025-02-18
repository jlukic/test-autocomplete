/**
 * A simple function that returns a greeting.
 * @param name The name to greet.
 * @returns A greeting string.
 */
export function greet(name: string): string;

/**
 * An interface representing a person.
 */
export interface Person {
  name: string;
  age: number;
}

/**
 * A function that takes a Person object and logs their details
 * @param person The Person to introduce
 */
export function introduce(person: Person): void;

/**
 * A function that returns a number
 */
export function giveMeANumber(): number;

/**
 * A class representing a Greeter
 */
export class Greeter {
  greeting: string;
  /**
   * @param message
   */
  constructor(message: string);
  /**
   * @param name
   * @returns
   */
  greet(name: string): string;
  /**
   * Overloaded method.
   * @param name
   * @param excited
   * @returns
   */
  greet(name: string, excited: boolean): string;
}

/**
 * A function with overloaded signatures
 */
export function processInput(input: string): string;
/**
 * A function with overloaded signatures
 */
export function processInput(input: number): number;

import { Person } from "./people.d.ts";

/**
 * A class representing a Greeter
 */
export class Greeter<T> { // Generic type parameter
  greeting: string;
  data: T;

  /**
   * @param message The greeting message
   * @param data The data to store
   */
  constructor(message: string, data: T);

  /**
   * @param name The name to greet
   * @returns A greeting string
   */
  greet(name: string): string;

  /**
   * Overloaded method.
   * @param name The name to greet
   * @param excited Whether to be excited
   * @returns A greeting string
   */
  greet(name: string, excited: boolean): string;

  /**
   * A generic method
   * @param value The value to process
   * @returns The processed value
   */
  process<U>(value: U): U;
}

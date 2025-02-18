import { Person } from "./people.d.ts";

/**
 * A class representing a Greeter
 */
export class Greeter<T> { // Generic type parameter
  greeting: string;
  data: T;

  /**
   * @param message
   * @param data
   */
  constructor(message: string, data: T);

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

  /**
   * A generic method
   * @param value
   * @returns
   */
  process<U>(value: U): U;
}

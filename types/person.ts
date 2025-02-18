/**
 * An interface representing a person.
 */
export interface Person {
  name: string;
  age: number;
  readonly address?: string; // Optional and readonly
  hobbies: string[];
}

/**
 * A function that takes a Person object and logs their details
 * @param person The Person to introduce
 */
export function introduce(person: Person): void;

/**
* A class representing a Person
*/
export class Person {
  name: string;
  age: number;
  readonly address?: string; // Optional and readonly
  hobbies: string[];
  constructor(name: string, age: number, address?: string, hobbies?: string[]);
}

/**
* A function that takes a Person object and logs their details
* @param person The Person to introduce
*/
export function introduce(person: Person): void;

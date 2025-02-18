
export interface Person {
  name: string;
  age: number;
  readonly address?: string; // Optional and readonly
  hobbies: string;
}

export function introduce(person: Person): void;

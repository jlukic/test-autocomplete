/**
 * A class representing a Person
 */
export class Person {
  constructor(name, age, address, hobbies =) {
    this.name = name;
    this.age = age;
    this.address = address;
    this.hobbies = hobbies;
  }
}

/**
 * A function that takes a Person object and logs their details
 * @param {{name: string, age: number, address?: string, hobbies: string}} person The Person to introduce
 */
export function introduce(person) {
  console.log(`This is ${person.name}, they are ${person.age} years old.`);
  if (person.address) {
    console.log(`They live at ${person.address}.`);
  }
  console.log(`Their hobbies are: ${person.hobbies.join(', ')}`);
}

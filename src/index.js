// A simple function that returns a greeting.
export function greet(name) {
  return `Hello, ${name}!`;
}

// A function that takes a Person object and logs their details
export function introduce(person) {
  console.log(`This is ${person.name}, they are ${person.age} years old.`);
}

// A function that returns a number
export function giveMeANumber() {
  return 42;
}

// A class representing a Greeter
export class Greeter {
  constructor(message) {
    this.greeting = message;
  }

  greet(name) {
    return `${this.greeting}, ${name}!`;
  }

  greet(name, excited) {
    if (excited) {
      return `${this.greeting}, ${name}!!!`;
    } else {
      return this.greet(name); // Call the other overload
    }
  }
}

// A function with overloaded signatures
export function processInput(input) {
  if (typeof input === 'string') {
    return input.toUpperCase();
  } else if (typeof input === 'number') {
    return input * 2;
  }
}

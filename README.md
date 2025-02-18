# test-autocomplete

This package is intended as a test package for REPL environments that might use [unpkg](http://unpkg.com/) and need to test autocompletion functionality.

This can be used to confirm intellisense functionality and test your app styling.

## Installation

```bash
npm install type-test
```

### Usage

```javascript
import { greet, Person, introduce, giveMeANumber, Greeter, processInput } from 'test-autocomplete';

console.log(greet("World")); // "Hello, World!"

const myPerson new Person({
  name: "Alice",
  age: 30,
  hobbies: ["reading", "hiking"]
});
introduce(myPerson); // "This is Alice, they are 30 years old. Their hobbies are: reading, hiking"

console.log(giveMeANumber()); // 42

const greeter = new Greeter("Hello", { id: 123 });
console.log(greeter.greet("Bob")); // "Hello, Bob! Data: {"id":123}"
console.log(greeter.greet("Charlie", true)); // "Hello, Charlie!!! Data: {"id":123}"

console.log(processInput("hello")); // HELLO
console.log(processInput(123)); // 246
console.log(processInput(myPerson)); // "Name: Alice, Age: 30"
```

### Exports

### Functions

* **`greet(name: string): string`:** Returns a greeting string.
* **`introduce(person: Person): void`:** Logs a person's introduction to the console.
* **`giveMeANumber(): number`:** Returns the number 42.
* **`processInput(input: string): string`:** Converts the input string to uppercase.
* **`processInput(input: number): number`:** Multiplies the input number by 2.
* **`processInput(input: Person): string`:** Returns a string representation of the person.

### Interface
* **`Person`:**  An interface representing a person.
    *   `name: string`
    *   `age: number`
    *   `address?: string` (optional)
    *   `hobbies: string`

### Class
* **`Greeter<T>`:** A class representing a Greeter that can hold any type of data.
    * **`constructor(message: string, data: T)`:** Creates a new Greeter instance with a greeting message and data of type T.
    * **`greet(name: string): string`:** Returns a greeting using the stored message and data.
    * **`greet(name: string, excited: boolean): string`:** Returns an optionally excited greeting using the stored message and data.

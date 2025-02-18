# test-autocomplete

This package is intended as a test package for REPL environments that might use [unpkg](http://unpkg.com/) and need to test autocompletion functionality.

This can be used to confirm intellisense functionality and test your app styling.

## Installation

```bash
npm install type-test
```

### Usage

```javascript
import { greet, Person, introduce, giveMeANumber, Greeter, processInput } from 'type-test';

console.log(greet("World")); // "Hello, World!"

const myPerson: Person = { name: "Alice", age: 30 };
introduce(myPerson); // "This is Alice, they are 30 years old."

console.log(giveMeANumber()); // 42

const greeter = new Greeter("Hello");
console.log(greeter.greet("Bob")); // "Hello, Bob!"
console.log(greeter.greet("Charlie", true)); // "Hello, Charlie!!!"

console.log(processInput("hello")); // HELLO
console.log(processInput(123)); // 246
```

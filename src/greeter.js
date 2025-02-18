export class Greeter {
  constructor(message, data) {
    this.greeting = message;
    this.data = data;
  }
  greet(name) {
    return `${this.greeting}, ${name}! Data: ${JSON.stringify(this.data)}`;
  }
  greet(name, excited) {
    if (excited) {
      return `${this.greeting}, ${name}!!! Data: ${JSON.stringify(this.data)}`;
    } else {
      return this.greet(name); // Call the other overload
    }
  }
  process(value) {
      return value;
  }
}

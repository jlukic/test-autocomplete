export class Greeter {
  constructor(message, data) {
    this.greeting = message;
    this.data = data;
  }
  greet(name, excited) {
    if (excited) {
      return `${this.greeting}, ${name}!!! Data: ${JSON.stringify(this.data)}`;
    } else {
      return `${this.greeting}, ${name}! Data: ${JSON.stringify(this.data)}`;
    }
  }
  process(value) {
    return value;
  }
}

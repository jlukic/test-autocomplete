export function giveMeANumber() {
  return 42;
}

/**
 * A function with overloaded signatures
 */
export function processInput(input) {
  if (typeof input === 'string') {
    return input.toUpperCase();
  } else if (typeof input === 'number') {
    return input * 2;
  } else if (typeof input === 'object' && input !== null && typeof input.name === 'string' && typeof input.age === 'number') {
      return `Name: ${input.name}, Age: ${input.age}`;
  }
}

/**
 * A function that returns a tuple
 */
export function returnTuple() {
  return ["hello", 123];
}

/**
 * A function that returns a union type
 */
export function returnUnion() {
  return Math.random() < 0.5 ? "string" : 123;
}

/**
 * A function that uses the enum
 * @param {number} color
 * @returns {string}
 */
export function describeColor(color) {
    switch (color) {
        case 0: return "Red";
        case 1: return "Green";
        case 2: return "Blue";
        default: return "Unknown";
    }
}

/**
 * A function that uses a conditional type
 * @param {string | number} value
 * @returns {string | number}
 */
export function nameOrAge(value) {
    return typeof value === 'string' ? value : value * 2;
}

/**
 * A function that takes a rest parameter
 * @param  {...number} args
 * @returns {number}
 */
export function sum(...args) {
    return args.reduce((a, b) => a + b, 0);
}

/**
 * A function with optional parameters
 * @param {number} a
 * @param {string} b
 * @param {boolean} c
 * @returns {number}
 */
export function optionalParams(a, b, c) {
    let result = a;
    if (b) result += b.length;
    if (c) result *= 2;
    return result;
}

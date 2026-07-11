// Empty mock for the 'canvas' native module.
// pdfjs-dist optionally requires canvas for Node.js server-side rendering.
// In React Native / Metro bundler, we never use this path, so we export an empty object.
module.exports = {};

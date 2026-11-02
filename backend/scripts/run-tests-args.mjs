// CreateProcess accepts at most 32767 UTF-16 code units including the NUL.
// Leave headroom and include the executable, separators and libuv's quoting.
export const COMMAND_LENGTH_LIMIT = 30000;

export function windowsArgumentLength(argument) {
  if (argument.length > 0 && !/[ \t"]/u.test(argument)) return argument.length;
  return 2 + argument.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, "$1$1").length;
}

export function testArgumentBatches(executable, prefix, files, limit = COMMAND_LENGTH_LIMIT) {
  const baseLength =
    windowsArgumentLength(executable) +
    1 +
    prefix.reduce((length, argument) => length + 1 + windowsArgumentLength(argument), 0);
  const batches = [];
  let batch = [];
  let length = baseLength;
  for (const file of files) {
    const addedLength = 1 + windowsArgumentLength(file);
    if (baseLength + addedLength > limit) {
      throw new RangeError(
        "run-tests: executable, flags and one test file exceed the command-line budget"
      );
    }
    if (length + addedLength > limit) {
      batches.push([...prefix, ...batch]);
      batch = [];
      length = baseLength;
    }
    batch.push(file);
    length += addedLength;
  }
  if (batch.length) batches.push([...prefix, ...batch]);
  return batches;
}

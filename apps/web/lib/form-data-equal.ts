export function formDataEqual(left: FormData, right: FormData): boolean {
  const leftEntries = [...left.entries()];
  const rightEntries = [...right.entries()];
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([name, value], index) =>
        name === rightEntries[index]?.[0] && value === rightEntries[index]?.[1],
    )
  );
}

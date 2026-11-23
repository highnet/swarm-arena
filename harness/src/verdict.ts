/**
 * The referee's results log is the end of each playbook, one line per task:
 * `- <date> UTC · <verdict> · <task title> · <detail>`. A task submitted again replaces its
 * earlier line instead of adding a second one (two "v0.4 passed" lines for one task).
 */
export const withVerdict = (text: string, title: string, line: string) => {
  const lines = text.trimEnd().split("\n");
  const start = lines.findIndex((l) => /^## Results log\s*$/.test(l));
  const sameTask = (l: string, i: number) =>
    start >= 0 &&
    i > start &&
    l.startsWith("- ") &&
    l.split(" · ")[2] === title;
  return `${[...lines.filter((l, i) => !sameTask(l, i)), line].join("\n")}\n`;
};

export const searchKeys = {
  all: ["search"] as const,
  directory: (query: string) =>
    [...searchKeys.all, "directory", query] as const,
};

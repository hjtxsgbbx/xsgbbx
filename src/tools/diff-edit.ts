export interface DiffEditResult {
  success: boolean;
  applied: boolean;
  output: string;
  strategy: "exact" | "trimmed" | "fuzzy" | "none";
  matchScore?: number;
}

export interface DiffHunk {
  search: string;
  replace: string;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function linesEqual(a: string, b: string, strategy: "exact" | "trimmed" | "fuzzy"): boolean {
  if (strategy === "exact") {
    return a === b;
  }
  if (strategy === "trimmed") {
    return a.trim() === b.trim();
  }
  return a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");
}

function findMatch(
  fileLines: string[],
  searchLines: string[],
  strategy: "exact" | "trimmed" | "fuzzy"
): number {
  if (searchLines.length === 0) return -1;

  for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
    let allMatch = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (!linesEqual(fileLines[i + j], searchLines[j], strategy)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return i;
  }

  return -1;
}

function fuzzyMatchScore(
  fileLines: string[],
  searchLines: string[]
): { index: number; score: number } {
  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
    let score = 0;
    for (let j = 0; j < searchLines.length; j++) {
      const fileLine = fileLines[i + j].trim();
      const searchLine = searchLines[j].trim();
      if (fileLine === searchLine) {
        score += 1;
      } else if (fileLine.length > 0 && searchLine.length > 0) {
        const commonChars = [...searchLine].filter((c) => fileLine.includes(c)).length;
        const maxLen = Math.max(fileLine.length, searchLine.length);
        score += commonChars / maxLen;
      }
    }
    const normalizedScore = score / searchLines.length;
    if (normalizedScore > bestScore) {
      bestScore = normalizedScore;
      bestIndex = i;
    }
  }

  return { index: bestIndex, score: bestScore };
}

export function applyEdit(
  fileContent: string,
  search: string,
  replace: string
): DiffEditResult {
  const normalizedContent = normalizeLineEndings(fileContent);
  const normalizedSearch = normalizeLineEndings(search);
  const normalizedReplace = normalizeLineEndings(replace);

  const fileLines = normalizedContent.split("\n");
  const searchLines = normalizedSearch.split("\n");
  const replaceLines = normalizedReplace.split("\n");

  let matchIndex = findMatch(fileLines, searchLines, "exact");
  let strategy: DiffEditResult["strategy"] = "exact";
  let fuzzyScore = 0;

  if (matchIndex < 0) {
    matchIndex = findMatch(fileLines, searchLines, "trimmed");
    strategy = "trimmed";
  }

  if (matchIndex < 0) {
    const fuzzy = fuzzyMatchScore(fileLines, searchLines);
    fuzzyScore = fuzzy.score;
    if (fuzzy.score >= 0.7) {
      matchIndex = fuzzy.index;
      strategy = "fuzzy";
    }
  }

  if (matchIndex < 0) {
    return {
      success: false,
      applied: false,
      output: "Could not find matching content in file. The file may have changed or the search text may be incorrect.",
      strategy: "none",
    };
  }

  const resultLines = [
    ...fileLines.slice(0, matchIndex),
    ...replaceLines,
    ...fileLines.slice(matchIndex + searchLines.length),
  ];

  const result = resultLines.join("\n");

  return {
    success: true,
    applied: true,
    output: `Edit applied using ${strategy} match${strategy === "fuzzy" ? ` (confidence: ${Math.round(fuzzyScore * 100)}%)` : ""}.`,
    strategy,
    matchScore: strategy === "exact" ? 1 : undefined,
  };
}

export function applyMultipleEdits(
  fileContent: string,
  hunks: DiffHunk[],
  maxAttempts = 3
): DiffEditResult[] {
  const results: DiffEditResult[] = [];
  let currentContent = fileContent;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const remaining: DiffHunk[] = [];

    for (const hunk of hunks) {
      const result = applyEdit(currentContent, hunk.search, hunk.replace);

      if (result.applied) {
        currentContent = replaceInContent(
          currentContent,
          hunk.search,
          hunk.replace,
        );
      } else {
        remaining.push(hunk);
      }

      results.push(result);
    }

    if (remaining.length === 0) break;
    if (attempt < maxAttempts - 1) {
      hunks.length = 0;
      hunks.push(...remaining);
    }
  }

  return results;
}

function replaceInContent(
  content: string,
  search: string,
  replace: string
): string {
  const normalizedContent = normalizeLineEndings(content);
  const normalizedSearch = normalizeLineEndings(search);
  const normalizedReplace = normalizeLineEndings(replace);

  const fileLines = normalizedContent.split("\n");
  const searchLines = normalizedSearch.split("\n");
  const replaceLines = normalizedReplace.split("\n");

  const matchIndex = findMatch(fileLines, searchLines, "exact")
    ?? findMatch(fileLines, searchLines, "trimmed");

  if (matchIndex < 0) return content;

  return [
    ...fileLines.slice(0, matchIndex),
    ...replaceLines,
    ...fileLines.slice(matchIndex + searchLines.length),
  ].join("\n");
}
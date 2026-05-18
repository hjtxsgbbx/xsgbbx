import React from "react";
import { Box, Text } from "ink";

export interface DiffChange {
  type: "add" | "remove" | "context";
  content: string;
  lineNumber?: number;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  changes: DiffChange[];
}

interface DiffViewerProps {
  files: DiffFile[];
  maxLinesPerFile?: number;
  showStats?: boolean;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  files,
  maxLinesPerFile = 50,
  showStats = true,
}) => {
  if (files.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No changes detected</Text>
      </Box>
    );
  }

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <Box flexDirection="column">
      {showStats && (
        <DiffStats
          fileCount={files.length}
          additions={totalAdditions}
          deletions={totalDeletions}
        />
      )}

      {files.map((file, index) => (
        <FileDiff
          key={file.path}
          file={file}
          maxLines={maxLinesPerFile}
          isLast={index === files.length - 1}
        />
      ))}
    </Box>
  );
};

const DiffStats: React.FC<{
  fileCount: number;
  additions: number;
  deletions: number;
}> = ({ fileCount, additions, deletions }) => {
  const totalChanges = additions + deletions;
  const addRatio = totalChanges > 0 ? additions / totalChanges : 0.5;
  const barWidth = 20;
  const addBar = Math.round(addRatio * barWidth);
  const delBar = barWidth - addBar;

  return (
    <Box flexDirection="row" marginBottom={1}>
      <Text bold>{fileCount} file{fileCount !== 1 ? "s" : ""} changed</Text>
      <Text> | </Text>
      <Text color="green">+{additions}</Text>
      <Text> </Text>
      <Text color="red">-{deletions}</Text>
      <Text> </Text>
      <Text color="green">{"█".repeat(addBar)}</Text>
      <Text color="red">{"█".repeat(delBar)}</Text>
    </Box>
  );
};

const FileDiff: React.FC<{
  file: DiffFile;
  maxLines: number;
  isLast: boolean;
}> = ({ file, maxLines, isLast }) => {
  const truncated = file.changes.length > maxLines;
  const visibleChanges = truncated
    ? [...file.changes.slice(0, maxLines - 5), ...file.changes.slice(-5)]
    : file.changes;
  const omittedCount = truncated ? file.changes.length - maxLines + 5 : 0;

  return (
    <Box flexDirection="column" marginBottom={isLast ? 0 : 1}>
      <Box flexDirection="row">
        <Text color="cyan" bold>{file.path}</Text>
        <Text dimColor>
          {" "}({file.additions} additions, {file.deletions} deletions)
        </Text>
      </Box>

      {visibleChanges.map((change, index) => (
        <DiffLine
          key={index}
          change={change}
          showOmission={index === maxLines - 6 && truncated}
          omittedCount={omittedCount}
        />
      ))}
    </Box>
  );
};

const DiffLine: React.FC<{
  change: DiffChange;
  showOmission: boolean;
  omittedCount: number;
}> = ({ change, showOmission, omittedCount }) => (
  <Box flexDirection="column">
    {showOmission && (
      <Text dimColor>{`  ... ${omittedCount} lines omitted ...`}</Text>
    )}
    <Box flexDirection="row">
      <Text dimColor>
        {change.lineNumber !== undefined
          ? String(change.lineNumber).padStart(4)
          : "    "}
        {" "}
      </Text>
      <Text color={change.type === "add" ? "green" : change.type === "remove" ? "red" : undefined}>
        {change.type === "add" ? "+" : change.type === "remove" ? "-" : " "}
      </Text>
      <Text
        color={change.type === "add" ? "green" : change.type === "remove" ? "red" : "gray"}
        dimColor={change.type === "context"}
      >
        {change.content}
      </Text>
    </Box>
  </Box>
);

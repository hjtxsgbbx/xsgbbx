// Diagnostic: test if Ink raw input works in your terminal
// Run: node test_enter.mjs
import { render, Box, Text } from "ink";
import React, { useState } from "react";
import TextInput from "ink-text-input";
import { writeFileSync } from "fs";

const LOG = [];

function TestApp() {
  const [value, setValue] = useState("");
  const [log, setLog] = useState("等待输入...");

  function handleChange(v) {
    LOG.push("onChange: " + v);
    setValue(v);
  }

  function handleSubmit(v) {
    LOG.push("onSubmit: " + v);
    writeFileSync("test_enter_log.txt", LOG.join("\n"));
    setLog("收到: " + v);
    setValue("");
    if (v === "exit") {
      setTimeout(() => process.exit(0), 100);
    }
  }

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, null, "状态: " + log),
    React.createElement(Text, null, " "),
    React.createElement(TextInput, {
      value,
      onChange: handleChange,
      onSubmit: handleSubmit,
      placeholder: "输入后按 Enter, 输入 exit 退出...",
    })
  );
}

const { waitUntilExit } = render(React.createElement(TestApp));

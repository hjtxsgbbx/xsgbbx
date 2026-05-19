import { render, Box, Text } from "ink";
import React, { useState } from "react";
import TextInput from "ink-text-input";

function TestApp() {
  const [value, setValue] = useState("");
  const [log, setLog] = useState("等待输入...");

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, null, "状态: " + log),
    React.createElement(Text, null, " "),
    React.createElement(TextInput, {
      value,
      onChange: (v) => {
        setValue(v);
      },
      onSubmit: (v) => {
        setLog("收到: " + v);
        setValue("");
      },
      placeholder: "输入后按 Enter...",
    })
  );
}

const { waitUntilExit } = render(React.createElement(TestApp));
setTimeout(() => {
  console.error("\n[TEST] 10秒超时，退出");
  process.exit(0);
}, 10000);

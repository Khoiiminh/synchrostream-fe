"use client";

import React, { useState, useRef, useEffect } from "react";
import { Stack, ScrollArea, Text, Box, TextInput, ActionIcon } from "@mantine/core";
import { Send } from "lucide-react";

interface FloatingMessage {
  username: string;
  text: string;
}

export default function FloatingChatOverlay() {
  const [messages, setMessages] = useState<FloatingMessage[]>([
    { username: "System", text: "Connected to video stream layout overhead layer." }
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = (e: React.SubmitEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setMessages((prev) => [...prev, { username: "Me", text: input.trim() }]);
    setInput("");
  };

  return (
    <Box 
      className="fixed bottom-6 right-6 z-40 flex flex-col gap-2"
      style={{ width: 320, height: 360 }}
    >
      {/* 100% borderless transparent message canvas */}
      <ScrollArea style={{ flex: 1 }} viewportRef={scrollRef} className="px-2">
        <Stack gap="xs" justify="end" className="min-h-full">
          {messages.map((msg, index) => (
            <Box key={index} className="bg-black/40 backdrop-blur-xs p-2 rounded-md border border-white/5 self-start max-w-[90%]">
              <Text size="11px" fw={700} color="teal.4" mb={1}>{msg.username}</Text>
              <Text size="xs" color="zinc.1" className="wrap-break-word leading-relaxed">
                {msg.text}
              </Text>
            </Box>
          ))}
        </Stack>
      </ScrollArea>

      <form onSubmit={handleSend} className="px-2">
        <TextInput
          placeholder="Type message..."
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          rightSection={
            <ActionIcon type="submit" variant="transparent" color="teal" disabled={!input.trim()}>
              <Send size={14} />
            </ActionIcon>
          }
          styles={{
            input: {
              backgroundColor: "rgba(15, 15, 17, 0.7)",
              backdropFilter: "blur(8px)",
              borderColor: "rgba(39, 39, 42, 0.6)",
              color: "#fff"
            }
          }}
        />
      </form>
    </Box>
  );
}
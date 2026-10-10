import { describe, expect, it } from "vitest";

import {
  aggregateMessaging,
  formatDuration,
  type MessagingMessageRow,
  type MessagingProfile,
} from "./aggregate";

const profiles: MessagingProfile[] = [
  { id: "p1", user_id: "u1", full_name: "Ana", email: "ana@x.com" },
  { id: "p2", user_id: "u2", full_name: "Beto", email: "beto@x.com" },
];

function row(
  overrides: Partial<MessagingMessageRow> & Pick<MessagingMessageRow, "conversation_id" | "sender_type" | "created_at">
): MessagingMessageRow {
  return { channel: "whatsapp", sender_id: null, ...overrides };
}

describe("aggregateMessaging", () => {
  it("counts sent / received and detects replies", () => {
    const rows: MessagingMessageRow[] = [
      row({ conversation_id: "c1", sender_type: "customer", created_at: "2026-01-01T10:00:00.000Z" }),
      row({ conversation_id: "c1", sender_type: "agent", sender_id: "u1", created_at: "2026-01-01T10:05:00.000Z" }),
      row({ conversation_id: "c1", sender_type: "customer", created_at: "2026-01-01T10:10:00.000Z" }),
      // no reply to the second customer message
      row({ conversation_id: "c2", sender_type: "agent", sender_id: "u2", created_at: "2026-01-01T11:00:00.000Z" }),
    ];

    const r = aggregateMessaging(rows, profiles, 7);

    expect(r.totals.sent).toBe(2);
    expect(r.totals.received).toBe(2);
    expect(r.totals.replied).toBe(1);
    expect(r.totals.responseRate).toBeCloseTo(0.5, 5);
    expect(r.totals.avgFirstResponseMin).toBeCloseTo(5, 5);
    expect(r.totals.activeAgents).toBe(2);
  });

  it("attributes agent sends via profiles.user_id and ranks them", () => {
    const rows: MessagingMessageRow[] = [
      row({ conversation_id: "c1", sender_type: "agent", sender_id: "u1", created_at: "2026-01-01T10:00:00.000Z" }),
      row({ conversation_id: "c1", sender_type: "agent", sender_id: "u1", created_at: "2026-01-01T10:01:00.000Z" }),
      row({ conversation_id: "c2", sender_type: "agent", sender_id: "u2", created_at: "2026-01-01T10:02:00.000Z" }),
      // unattributed (bot / API) — counts as sent, not as agent
      row({ conversation_id: "c2", sender_type: "bot", created_at: "2026-01-01T10:03:00.000Z" }),
    ];

    const r = aggregateMessaging(rows, profiles, 7);

    expect(r.totals.sent).toBe(4);
    expect(r.agents.map((a) => a.fullName)).toEqual(["Ana", "Beto"]);
    expect(r.agents[0]).toMatchObject({ sent: 2, conversations: 1 });
    expect(r.agents[1]).toMatchObject({ sent: 1, conversations: 1 });
  });

  it("groups by channel and normalises a missing channel to whatsapp", () => {
    const rows: MessagingMessageRow[] = [
      { conversation_id: "e1", sender_type: "customer", created_at: "2026-01-01T10:00:00.000Z", channel: "email" },
      { conversation_id: "e1", sender_type: "agent", sender_id: "u1", created_at: "2026-01-01T10:02:00.000Z", channel: "email" },
      { conversation_id: "w1", sender_type: "customer", created_at: "2026-01-01T10:00:00.000Z", channel: null },
    ];

    const r = aggregateMessaging(rows, profiles, 7);
    const byChannel = new Map(r.channels.map((c) => [c.channel, c]));

    expect(byChannel.get("email")).toMatchObject({ sent: 1, received: 1, replied: 1 });
    expect(byChannel.get("whatsapp")).toMatchObject({ sent: 0, received: 1, replied: 0 });
    expect(byChannel.get("email")?.avgFirstResponseMin).toBeCloseTo(2, 5);
  });

  it("seeds one series point per day in the range, even with no activity", () => {
    const rows: MessagingMessageRow[] = [
      row({ conversation_id: "c1", sender_type: "customer", created_at: "2026-01-01T10:00:00.000Z" }),
    ];

    const r = aggregateMessaging(rows, profiles, 30);
    expect(r.series).toHaveLength(30);
    expect(r.series.every((p) => Number.isFinite(p.incoming))).toBe(true);
  });
});

describe("formatDuration", () => {
  it("renders minutes, hours and days", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0.4)).toBe("<1 min");
    expect(formatDuration(12.4)).toBe("12 min");
    expect(formatDuration(65)).toBe("1 h 5 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(60 * 26)).toBe("1 d 2 h");
  });
});

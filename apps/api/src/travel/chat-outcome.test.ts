import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  weekdayConflict,
  claimsMutation,
  toolData,
  verifiedProposalText,
} from "./chat-outcome";
import type { TravelTrip, TravelProposal } from "@open-sunsama/types";
const trip = (): TravelTrip => ({
  id: randomUUID(),
  title: "大同",
  timezone: "Asia/Shanghai",
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  revision: 1,
  activities: [],
});
describe("聊天结果证据", () => {
  it("周一/周二不属于周四至周六行程，必须澄清", () => {
    expect(weekdayConflict("周一华严寺十点，周二小院十二点", trip())).toContain(
      "请确认具体日期",
    );
    expect(weekdayConflict("周四古城墙下午五点", trip())).toBeNull();
  });
  it("屏蔽无证据的中文和英文修改声明", () => {
    for (const text of [
      "已提交修改提案",
      "已经修改到十点",
      "成功保存",
      "proposal has been submitted",
    ])
      expect(claimsMutation(text)).toBe(true);
    expect(claimsMutation("当前路程未知，需要选择地点")).toBe(false);
  });
  it("优先结构化结果，兼容旧文本", () => {
    expect(
      toolData({
        structuredContent: { data: { revision: 3 } },
        content: [{ type: "text", text: "bad" }],
      }),
    ).toEqual({ revision: 3 });
    expect(
      toolData({ content: [{ type: "text", text: '{"revision":2}' }] }),
    ).toEqual({ revision: 2 });
  });
  it("提案正文由真实前后数据生成，区分待确认/过期/已执行", () => {
    const before = trip();
    before.activities = [
      {
        id: randomUUID(),
        title: "华严寺",
        date: "2026-10-01",
        start: 645,
        duration: 90,
        notes: "",
        place: "",
        locked: false,
        position: 0,
      },
    ];
    const after = structuredClone(before);
    after.activities[0]!.start = 600;
    const p: TravelProposal = {
      id: randomUUID(),
      tripId: before.id,
      revision: 1,
      reason: "调整",
      status: "pending",
      before,
      after,
      operations: [
        { type: "edit", id: before.activities[0]!.id, patch: { start: 600 } },
      ],
      result: null,
    };
    expect(verifiedProposalText([p], 1)).toContain("10:45 → 2026-10-01 10:00");
    expect(verifiedProposalText([p], 1)).toContain("尚未修改");
    expect(verifiedProposalText([p], 2)).toContain("过期");
    p.status = "applied";
    expect(verifiedProposalText([p], 2)).toContain("用户确认保存");
  });
});

it("只读查询不能误判为已修改，真实修改声明仍拒绝", () => {
  expect(claimsMutation("已核查，但尚未修改行程")).toBe(false);
  expect(claimsMutation("已修改行程但未保存")).toBe(true);
});

it("不可行解释与否定提案不当作已执行，真实已执行仍被识别", () => {
  expect(claimsMutation("已知停留90分钟，建议调整条件")).toBe(false);
  expect(claimsMutation("不能生成修改提案")).toBe(false);
  expect(claimsMutation("不自动创建提案")).toBe(false);
  expect(claimsMutation("已把博物馆修改到15点")).toBe(true);
});

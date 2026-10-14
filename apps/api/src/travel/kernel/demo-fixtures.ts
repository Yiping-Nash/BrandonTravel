// 复用 fixtures/travel/timetable-faults.json 的受信内置样例；只在内存演示。
export const demoFixtures = {
  version: 1,
  productionImportAllowed: false,
  kind: "isolated-mock-input",
  clock: "2026-10-07T04:00:00Z",
  contractStatus:
    "测试意图；事实字段待Phase2正式类型落地后转换，不是当前REST或供应商响应",
  cases: [
    {
      key: "overlap",
      trip: {
        id: "56142374-f6dd-51a6-9980-99ae78a96f72",
        title: "隔离故障测试｜重叠",
        startDate: "2026-10-13",
        endDate: "2026-10-19",
        timezone: "Asia/Shanghai",
        revision: 0,
        activities: [
          {
            id: "e91999ac-11d4-5614-944c-3dba90afb050",
            title: "大同 · 早餐",
            notes:
              "模拟测试：日期与时间是测试计划；地点未选择真实POI，开放、预约和交通耗时均未核实。",
            place: "大同 · 餐厅待选择",
            date: "2026-10-13",
            start: 540,
            duration: 90,
            locked: false,
            position: 0,
          },
          {
            id: "f7b44d52-1db3-5fa7-8625-1321d12e6767",
            title: "大同 · 华严寺",
            notes:
              "模拟测试：日期与时间是测试计划；地点未选择真实POI，开放、预约和交通耗时均未核实。",
            place: "大同 · 华严寺",
            date: "2026-10-13",
            start: 570,
            duration: 60,
            locked: false,
            position: 1,
          },
        ],
      },
      mockFacts: [],
      expected: { rule: "OVERLAP", state: "CONFLICT" },
      currentVerification: "现有领域conflicts可执行",
    },
    {
      key: "route-shortage",
      trip: {
        id: "417a074c-c83a-511c-ad35-bde3c3fc17c8",
        title: "隔离故障测试｜路程不足13分钟",
        startDate: "2026-10-13",
        endDate: "2026-10-19",
        timezone: "Asia/Shanghai",
        revision: 0,
        activities: [
          {
            id: "a4b36535-d07d-5b54-a14a-5b3c25a3ecef",
            title: "大同 · 早餐",
            notes:
              "模拟测试：日期与时间是测试计划；地点未选择真实POI，开放、预约和交通耗时均未核实。",
            place: "大同 · 餐厅待选择",
            date: "2026-10-13",
            start: 780,
            duration: 60,
            locked: false,
            position: 0,
          },
          {
            id: "0a801143-365a-566b-9a05-143c8bfb3657",
            title: "大同 · 华严寺",
            notes:
              "模拟测试：日期与时间是测试计划；地点未选择真实POI，开放、预约和交通耗时均未核实。",
            place: "大同 · 华严寺",
            date: "2026-10-13",
            start: 870,
            duration: 60,
            locked: false,
            position: 1,
          },
        ],
      },
      mockFacts: [
        {
          kind: "route_estimate",
          source: "mock-fixture",
          fromActivityId: "a4b36535-d07d-5b54-a14a-5b3c25a3ecef",
          toActivityId: "0a801143-365a-566b-9a05-143c8bfb3657",
          durationSeconds: 2580,
          fresh: true,
          queriedAt: "2026-10-07T04:00:00Z",
          expiresAt: "2026-10-07T04:15:00Z",
          inputMatches: true,
        },
      ],
      expected: {
        rule: "TRANSITION_GAP",
        state: "CONFLICT",
        shortageMinutes: 13,
      },
      currentVerification: "引擎未实现，仅测试输入与期望",
      evaluationContext: {
        confirmedPlaceBindings: [
          {
            activityId: "a4b36535-d07d-5b54-a14a-5b3c25a3ecef",
            entityId: "de7b6314-8f3d-578c-b500-1f0a12431040",
          },
          {
            activityId: "0a801143-365a-566b-9a05-143c8bfb3657",
            entityId: "fa24dd3c-a4a4-56fb-b269-b444f0122f08",
          },
        ],
        mockEntities: [
          {
            id: "de7b6314-8f3d-578c-b500-1f0a12431040",
            name: "模拟地点1",
            coordinates: {
              longitude: 113.3,
              latitude: 40,
              coordinateSystem: "GCJ-02",
            },
            source: "mock-fixture",
            region: "大同",
          },
          {
            id: "fa24dd3c-a4a4-56fb-b269-b444f0122f08",
            name: "模拟地点2",
            coordinates: {
              longitude: 113.31,
              latitude: 40.01,
              coordinateSystem: "GCJ-02",
            },
            source: "mock-fixture",
            region: "大同",
          },
        ],
        note: "仅隔离测试上下文；不经生产地点确认、不导入REST。Phase2加载器转换为正式中立模型。",
      },
    },
    {
      key: "lunch-closure",
      trip: {
        id: "5d91b221-09cb-582b-8db2-6f22bfafa9bb",
        title: "隔离故障测试｜午间闭馆",
        startDate: "2026-10-13",
        endDate: "2026-10-19",
        timezone: "Asia/Shanghai",
        revision: 0,
        activities: [
          {
            id: "a62c3685-f0c8-5c31-8e06-c23fccfbbe5d",
            title: "大同 · 华严寺",
            notes:
              "模拟测试：日期与时间是测试计划；地点未选择真实POI，开放、预约和交通耗时均未核实。",
            place: "大同 · 华严寺",
            date: "2026-10-13",
            start: 840,
            duration: 60,
            locked: false,
            position: 1,
          },
        ],
      },
      mockFacts: [
        {
          kind: "opening_hours",
          source: "mock-fixture",
          activityId: "a62c3685-f0c8-5c31-8e06-c23fccfbbe5d",
          date: "2026-10-13",
          intervals: [
            [630, 870],
            [1020, 1290],
          ],
          quality: "complete",
        },
      ],
      expected: { rule: "OPENING_COVERAGE", state: "CONFLICT" },
      currentVerification: "引擎未实现，仅测试输入与期望",
      evaluationContext: {
        confirmedPlaceBindings: [
          {
            activityId: "a62c3685-f0c8-5c31-8e06-c23fccfbbe5d",
            entityId: "c0311336-691b-59fb-9a66-e5e525f484dd",
          },
        ],
        mockEntities: [
          {
            id: "c0311336-691b-59fb-9a66-e5e525f484dd",
            name: "模拟地点1",
            coordinates: {
              longitude: 113.3,
              latitude: 40,
              coordinateSystem: "GCJ-02",
            },
            source: "mock-fixture",
            region: "大同",
          },
        ],
        note: "仅隔离测试上下文；不经生产地点确认、不导入REST。Phase2加载器转换为正式中立模型。",
      },
    },
    {
      key: "missing-place",
      trip: {
        id: "b5fb2923-ab53-52c4-9bdb-ab35f8dea8ae",
        title: "隔离故障测试｜缺地点",
        startDate: "2026-10-13",
        endDate: "2026-10-19",
        timezone: "Asia/Shanghai",
        revision: 0,
        activities: [
          {
            id: "9873fc24-cdb6-5aba-bafa-cfb437ab845d",
            title: "大同 · 早餐",
            notes:
              "模拟测试：日期与时间是测试计划；地点未选择真实POI，开放、预约和交通耗时均未核实。",
            place: "大同 · 餐厅待选择",
            date: "2026-10-13",
            start: 480,
            duration: 45,
            locked: false,
            position: 0,
          },
          {
            id: "95b0dd0b-8429-545a-9b4e-f652994af081",
            title: "大同 · 华严寺",
            notes:
              "模拟测试：日期与时间是测试计划；地点未选择真实POI，开放、预约和交通耗时均未核实。",
            place: "地点待确认",
            date: "2026-10-13",
            start: 540,
            duration: 120,
            locked: false,
            position: 1,
          },
        ],
      },
      mockFacts: [],
      expected: {
        rule: "TRANSITION_GAP",
        state: "UNKNOWN",
        reason: "缺少已确认地点",
      },
      currentVerification: "引擎未实现，仅测试输入与期望",
    },
    {
      key: "forecast-out-of-range",
      trip: {
        id: "2b530945-c797-5781-9218-abef860efe10",
        title: "隔离故障测试｜预报范围外",
        startDate: "2026-10-13",
        endDate: "2026-10-19",
        timezone: "Asia/Shanghai",
        revision: 0,
        activities: [
          {
            id: "ee7d87ba-4504-52d2-871a-ab5ce6452cd6",
            title: "大同 · 早餐",
            notes:
              "模拟测试：日期与时间是测试计划；地点未选择真实POI，开放、预约和交通耗时均未核实。",
            place: "大同 · 餐厅待选择",
            date: "2026-10-13",
            start: 480,
            duration: 45,
            locked: false,
            position: 0,
          },
          {
            id: "f1e5265b-67ec-5af6-b9e5-2f5052ba377f",
            title: "大同 · 华严寺",
            notes:
              "模拟测试：日期与时间是测试计划；地点未选择真实POI，开放、预约和交通耗时均未核实。",
            place: "大同 · 华严寺",
            date: "2026-10-13",
            start: 540,
            duration: 120,
            locked: false,
            position: 1,
          },
        ],
      },
      mockFacts: [
        {
          kind: "weather",
          source: "mock-fixture",
          region: "大同",
          coverageDates: [
            "2026-10-07",
            "2026-10-08",
            "2026-10-09",
            "2026-10-10",
          ],
        },
      ],
      expected: {
        rule: "OUTDOOR_STRONG_RAIN",
        state: "UNKNOWN",
        reasonCode: "FORECAST_OUT_OF_RANGE",
      },
      currentVerification: "引擎未实现，仅测试输入与期望",
      evaluationContext: {
        confirmedPlaceBindings: [
          {
            activityId: "ee7d87ba-4504-52d2-871a-ab5ce6452cd6",
            entityId: "c4ff3b1e-10d6-54a6-9ef3-77c2495ed51e",
          },
          {
            activityId: "f1e5265b-67ec-5af6-b9e5-2f5052ba377f",
            entityId: "3ca3b1f1-d284-5dc7-9ad4-8ddb14b1223f",
          },
        ],
        mockEntities: [
          {
            id: "c4ff3b1e-10d6-54a6-9ef3-77c2495ed51e",
            name: "模拟地点1",
            coordinates: {
              longitude: 113.3,
              latitude: 40,
              coordinateSystem: "GCJ-02",
            },
            source: "mock-fixture",
            region: "大同",
          },
          {
            id: "3ca3b1f1-d284-5dc7-9ad4-8ddb14b1223f",
            name: "模拟地点2",
            coordinates: {
              longitude: 113.31,
              latitude: 40.01,
              coordinateSystem: "GCJ-02",
            },
            source: "mock-fixture",
            region: "大同",
          },
        ],
        note: "仅隔离测试上下文；不经生产地点确认、不导入REST。Phase2加载器转换为正式中立模型。",
        activityEnvironment: {
          "ee7d87ba-4504-52d2-871a-ab5ce6452cd6": "outdoor",
          "f1e5265b-67ec-5af6-b9e5-2f5052ba377f": "outdoor",
        },
      },
    },
  ],
} as const;

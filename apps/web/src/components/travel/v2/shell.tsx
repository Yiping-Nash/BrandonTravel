import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import "./v2.css";
export function useAppearance() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("bt-appearance") || "sand",
  );
  return {
    theme,
    setTheme: (s: string) => {
      localStorage.setItem("bt-appearance", s);
      setTheme(s);
    },
  };
}
export function V2Shell({
  children,
  theme,
  setTheme,
  tripId,
  onChat,
}: {
  children: ReactNode;
  theme: string;
  setTheme: (s: string) => void;
  tripId?: string;
  onChat?: () => void;
}) {
  const { user, logout } = useAuth();
  return (
    <div className="bt-v2" data-theme={theme}>
      <header className="bt-nav">
        <Link to="/" className="bt-brand">
          ✦ BrandonTravel
        </Link>
        <nav>
          <Link to="/">我的旅行</Link>
          <span title="未开放">灵感 · 未开放</span>
          <span title="未开放">收藏 · 未开放</span>
        </nav>
        <div className="bt-nav-actions">
          <select
            aria-label="外观"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="sand">暖阳 Sand</option>
            <option value="teal">海盐 Teal</option>
            <option value="blue">晴空 Blue</option>
          </select>
          <a href={tripId ? `/legacy?tripId=${tripId}` : "/legacy"}>切换旧版</a>
          {onChat && (
            <button className="bt-primary" onClick={onChat}>
              ✦ 问 Brandon
            </button>
          )}
          <button onClick={() => void logout()} title="退出登录">
            {user?.name || "旅行者"} · 退出
          </button>
        </div>
      </header>
      {children}
      <footer className="bt-footer">
        基于 Open Sunsama · 计划不等于预订 · 现实信息保留来源与时效
      </footer>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Settings,
  Trash2,
  X,
} from "lucide-react";

type TagConfigForm = {
  id: string;
  label: string;
};

type SettingsForm = {
  arxivDailyUrl: string;
  autoFetchEnabled: boolean;
  cronLocalTime: string;
  timeZone: string;
  conductorBaseUrl: string;
  conductorToken: string;
  conductorTokenConfigured: boolean;
  conductorDaemonHost: string;
  conductorWorkspacePath: string;
  conductorAppName: string;
  conductorBackendType: string;
  tags: TagConfigForm[];
};

const emptyForm: SettingsForm = {
  arxivDailyUrl: "",
  autoFetchEnabled: true,
  cronLocalTime: "02:00",
  timeZone: "Asia/Shanghai",
  conductorBaseUrl: "",
  conductorToken: "",
  conductorTokenConfigured: false,
  conductorDaemonHost: "",
  conductorWorkspacePath: "",
  conductorAppName: "arxiv-radar",
  conductorBackendType: "",
  tags: [],
};

function knownSettings(value: unknown): value is SettingsForm {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SettingsForm>;
  return (
    typeof candidate.arxivDailyUrl === "string" &&
    typeof candidate.autoFetchEnabled === "boolean" &&
    typeof candidate.cronLocalTime === "string" &&
    typeof candidate.timeZone === "string" &&
    typeof candidate.conductorBaseUrl === "string" &&
    typeof candidate.conductorToken === "string" &&
    typeof candidate.conductorTokenConfigured === "boolean" &&
    typeof candidate.conductorDaemonHost === "string" &&
    typeof candidate.conductorWorkspacePath === "string" &&
    typeof candidate.conductorAppName === "string" &&
    typeof candidate.conductorBackendType === "string" &&
    Array.isArray(candidate.tags)
  );
}

export function SettingsPopup() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SettingsForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function loadSettings() {
      setLoading(true);
      setError("");
      setSaved(false);

      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok || !knownSettings(payload)) {
          throw new Error(payload?.error || "读取配置失败");
        }
        if (!cancelled) {
          setForm(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [open]);

  function updateField<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setSaved(false);
    setError("");
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function addTag() {
    setSaved(false);
    setError("");
    setForm((current) => ({
      ...current,
      tags: [...current.tags, { id: "", label: "" }],
    }));
  }

  function updateTag(index: number, field: "id" | "label", value: string) {
    setSaved(false);
    setError("");
    setForm((current) => ({
      ...current,
      tags: current.tags.map((tag, i) =>
        i === index ? { ...tag, [field]: value } : tag,
      ),
    }));
  }

  function removeTag(index: number) {
    setSaved(false);
    setError("");
    setForm((current) => ({
      ...current,
      tags: current.tags.filter((_, i) => i !== index),
    }));
  }

  async function saveSettings() {
    setSaving(true);
    setSaved(false);
    setError("");

    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
      const payload = await response.json();

      if (!response.ok || !knownSettings(payload)) {
        throw new Error(payload?.error || "保存配置失败");
      }

      setForm(payload);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="打开配置"
        title="配置"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 dark:hover:text-white"
      >
        <Settings className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-zinc-950/40 px-3 py-4 backdrop-blur-sm sm:py-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false);
            }
          }}
        >
          <div className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div className="min-w-0">
                <h2 id="settings-title" className="text-base font-semibold tracking-normal">
                  配置
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭配置"
                title="关闭"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-5 px-4 py-4">
              {loading ? (
                <div className="flex min-h-64 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  加载中...
                </div>
              ) : (
                <>
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold tracking-normal">arxiv daily</h3>
                    <label className="block text-sm">
                      <span className="mb-1.5 block text-zinc-600 dark:text-zinc-300">拉取链接</span>
                      <input
                        type="url"
                        value={form.arxivDailyUrl}
                        onChange={(event) => updateField("arxivDailyUrl", event.target.value)}
                        className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-500"
                        placeholder="https://arxiv.org/list/cs.RO/recent?skip=0&show=100"
                      />
                    </label>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold tracking-normal">cron</h3>
                    <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                      <label className="flex h-10 items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 text-sm dark:border-zinc-800">
                        <span className="text-zinc-700 dark:text-zinc-200">自动拉取</span>
                        <input
                          type="checkbox"
                          checked={form.autoFetchEnabled}
                          onChange={(event) => updateField("autoFetchEnabled", event.target.checked)}
                          className="h-4 w-4 accent-zinc-950 dark:accent-white"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="sr-only">每天自动拉取时间</span>
                        <input
                          type="time"
                          value={form.cronLocalTime}
                          onChange={(event) => updateField("cronLocalTime", event.target.value)}
                          className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-500"
                        />
                      </label>
                    </div>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold tracking-normal">chat</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm">
                        <span className="mb-1.5 block text-zinc-600 dark:text-zinc-300">daemon</span>
                        <input
                          type="text"
                          value={form.conductorDaemonHost}
                          onChange={(event) => updateField("conductorDaemonHost", event.target.value)}
                          className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-500"
                          placeholder="m1"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1.5 block text-zinc-600 dark:text-zinc-300">AI backend</span>
                        <input
                          type="text"
                          value={form.conductorBackendType}
                          onChange={(event) => updateField("conductorBackendType", event.target.value)}
                          className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-500"
                          placeholder="codex"
                        />
                      </label>
                      <label className="block text-sm sm:col-span-2">
                        <span className="mb-1.5 block text-zinc-600 dark:text-zinc-300">workspace</span>
                        <input
                          type="text"
                          value={form.conductorWorkspacePath}
                          onChange={(event) => updateField("conductorWorkspacePath", event.target.value)}
                          className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-500"
                          placeholder="~/ws/workspace"
                        />
                      </label>
                      <label className="block text-sm sm:col-span-2">
                        <span className="mb-1.5 block text-zinc-600 dark:text-zinc-300">app name</span>
                        <input
                          type="text"
                          value={form.conductorAppName}
                          onChange={(event) => updateField("conductorAppName", event.target.value)}
                          className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-500"
                          placeholder="arxiv-radar"
                        />
                      </label>
                    </div>
                  </section>

                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold tracking-normal">tags</h3>
                      <button
                        type="button"
                        onClick={addTag}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" />
                        添加
                      </button>
                    </div>
                    {form.tags.length === 0 ? (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        暂无标签，点击添加。
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {form.tags.map((tag, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={tag.id}
                              onChange={(event) => updateTag(index, "id", event.target.value)}
                              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-500"
                              placeholder="ID (如 vla)"
                            />
                            <input
                              type="text"
                              value={tag.label}
                              onChange={(event) => updateTag(index, "label", event.target.value)}
                              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-500"
                              placeholder="显示名 (如 VLA)"
                            />
                            <button
                              type="button"
                              onClick={() => removeTag(index)}
                              aria-label="删除标签"
                              title="删除"
                              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
              <div className="min-h-5 text-sm">
                {error ? (
                  <span className="inline-flex items-center gap-2 text-red-600 dark:text-red-400">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    {error}
                  </span>
                ) : saved ? (
                  <span className="inline-flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    已保存
                  </span>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-10 items-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveSettings}
                  disabled={loading || saving}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="h-4 w-4" aria-hidden="true" />
                  )}
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
          , document.body)
        : null}
    </>
  );
}

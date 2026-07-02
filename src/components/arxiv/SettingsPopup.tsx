"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Info,
  Loader2,
  Plus,
  Save,
  Settings,
  Trash2,
  X,
} from "lucide-react";

const DEFAULT_APP_NAME = "arxiv-radar-chat";

/** Help copy shown when hovering the `?` next to each setting. */
const FIELD_HELP = {
  arxivDailyUrl:
    "arXiv 列表页链接，决定每天拉取哪些论文。到 arxiv.org 选好分类后复制地址栏链接，例如机器人方向：https://arxiv.org/list/cs.RO/recent?skip=0&show=100",
  autoFetch:
    "开启后系统会每天在右侧设定的时间，按上面的拉取链接自动抓取并分析新论文。时间为 24 小时制，使用服务器时区。",
  tags:
    "自定义论文标签，用于自动分类与筛选。ID 为英文小写标识（如 vla），显示名为界面上展示的文字（如 VLA）。",
} as const;

/** Fields a user must fill before the app becomes usable. Mirrors isAppConfigured(). */
const REQUIRED_FIELDS = [
  { key: "arxivDailyUrl", label: "拉取链接" },
] as const;

function HelpTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex shrink-0 items-center">
      <HelpCircle
        className="h-3.5 w-3.5 cursor-help text-zinc-400 outline-none transition hover:text-zinc-600 focus-visible:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 dark:focus-visible:text-zinc-300"
        aria-label={text}
        role="img"
        tabIndex={0}
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-[110] mt-1.5 w-64 max-w-[70vw] rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-normal leading-relaxed text-zinc-600 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      >
        {text}
      </span>
    </span>
  );
}

function FieldLabel({
  children,
  help,
  required = false,
}: {
  children: ReactNode;
  help: string;
  required?: boolean;
}) {
  return (
    <span className="mb-1.5 flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
      <span>{children}</span>
      {required ? (
        <span className="text-red-500 dark:text-red-400" aria-hidden="true">
          *
        </span>
      ) : null}
      <HelpTip text={help} />
    </span>
  );
}

type TagConfigForm = {
  id: string;
  label: string;
};

type SettingsForm = {
  arxivDailyUrl: string;
  autoFetchEnabled: boolean;
  cronLocalTime: string;
  cronAllowed: boolean;
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
  cronAllowed: true,
  timeZone: "Asia/Shanghai",
  conductorBaseUrl: "",
  conductorToken: "",
  conductorTokenConfigured: false,
  conductorDaemonHost: "",
  conductorWorkspacePath: "",
  conductorAppName: DEFAULT_APP_NAME,
  conductorBackendType: "",
  tags: [],
};

function missingRequiredLabels(form: SettingsForm): string[] {
  return REQUIRED_FIELDS.filter(
    (field) => !String(form[field.key] ?? "").trim(),
  ).map((field) => field.label);
}

function knownSettings(value: unknown): value is SettingsForm {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SettingsForm>;
  return (
    typeof candidate.arxivDailyUrl === "string" &&
    typeof candidate.autoFetchEnabled === "boolean" &&
    typeof candidate.cronLocalTime === "string" &&
    typeof candidate.cronAllowed === "boolean" &&
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

export function SettingsPopup({ requireSetup = false }: { requireSetup?: boolean } = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SettingsForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Onboarding: when the account is not yet configured, force the dialog open
  // and keep it open until the required settings are saved.
  useEffect(() => {
    if (requireSetup) {
      setOpen(true);
    }
  }, [requireSetup]);

  function closeDialog() {
    if (requireSetup) return;
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDialog();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requireSetup]);

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
    const missing = missingRequiredLabels(form);
    if (missing.length > 0) {
      setSaved(false);
      setError(`请先填写必填项：${missing.join("、")}`);
      return;
    }

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

      // Onboarding complete: required fields are filled, so the next render
      // drops requireSetup. Close the dialog and let the app become usable.
      if (requireSetup && missingRequiredLabels(payload).length === 0) {
        setOpen(false);
      }
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
              closeDialog();
            }
          }}
        >
          <div className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div className="min-w-0">
                <h2 id="settings-title" className="text-base font-semibold tracking-normal">
                  {requireSetup ? "初始化配置" : "配置"}
                </h2>
              </div>
              {requireSetup ? null : (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="关闭配置"
                  title="关闭"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="space-y-5 px-4 py-4">
              {loading ? (
                <div className="flex min-h-64 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  加载中...
                </div>
              ) : (
                <>
                  {requireSetup ? (
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <p>
                        欢迎使用 arxiv-radar！首次使用前请先完成下方配置，带
                        <span className="px-0.5 font-medium text-red-600 dark:text-red-400">*</span>
                        为必填项，保存后即可开始使用。
                      </p>
                    </div>
                  ) : null}

                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold tracking-normal">arxiv daily</h3>
                    <label className="block text-sm">
                      <FieldLabel help={FIELD_HELP.arxivDailyUrl} required>
                        拉取链接
                      </FieldLabel>
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
                      <label
                        className={`flex h-10 items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 text-sm dark:border-zinc-800${
                          form.cronAllowed ? "" : " opacity-60"
                        }`}
                      >
                        <span className="flex items-center gap-1 text-zinc-700 dark:text-zinc-200">
                          自动拉取
                          <HelpTip text={FIELD_HELP.autoFetch} />
                        </span>
                        <input
                          type="checkbox"
                          checked={form.cronAllowed && form.autoFetchEnabled}
                          disabled={!form.cronAllowed}
                          onChange={(event) => updateField("autoFetchEnabled", event.target.checked)}
                          className="h-4 w-4 accent-zinc-950 disabled:cursor-not-allowed dark:accent-white"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="sr-only">每天自动拉取时间</span>
                        <input
                          type="time"
                          value={form.cronLocalTime}
                          disabled={!form.cronAllowed}
                          onChange={(event) => updateField("cronLocalTime", event.target.value)}
                          className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-500"
                        />
                      </label>
                    </div>
                    {!form.cronAllowed && (
                      <p className="text-xs text-amber-600 dark:text-amber-500">
                        请联系管理员支持此功能
                      </p>
                    )}
                  </section>

                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="flex items-center gap-1 text-sm font-semibold tracking-normal">
                        tags
                        <HelpTip text={FIELD_HELP.tags} />
                      </h3>
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
                {requireSetup ? null : (
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-10 items-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    取消
                  </button>
                )}
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
                  {requireSetup ? "完成配置" : "确认"}
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

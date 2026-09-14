import { CONFIG } from "./config.js";
import { TaskModel } from "./task-model.js";

export class TaskSyncService {
  constructor(getToken) {
    this.getToken = getToken;
  }

  buildRemoteDocument(snapshot, revision) {
    const normalized = TaskModel.normalizeSnapshot(snapshot);
    return { ...normalized, revision: Math.max(0, Number(revision) || 0) };
  }

  parseRemoteDocument(raw) {
    const normalized = TaskModel.normalizeSnapshot(raw);
    return { snapshot: normalized, revision: Math.max(0, Number(raw?.revision) || 0) };
  }

  async githubApiRequest(path, options = {}, token = this.getToken?.() || "") {
    const headers = {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${CONFIG.GITHUB_API_BASE}${path}`, { ...options, headers });
  }

  async buildGithubApiError(response, prefix) {
    let detail = "";
    try {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const payload = await response.json();
        const message = typeof payload?.message === "string" ? payload.message.trim() : "";
        const errorDetails = Array.isArray(payload?.errors)
          ? payload.errors
              .map((entry) => {
                if (typeof entry === "string") return entry.trim();
                if (entry && typeof entry === "object") {
                  const reason = typeof entry.message === "string" ? entry.message.trim() : "";
                  const field = typeof entry.field === "string" ? entry.field.trim() : "";
                  if (reason && field) return `${reason} (${field})`;
                  return reason || field;
                }
                return "";
              })
              .filter(Boolean)
          : [];
        detail = [message, ...errorDetails].filter(Boolean).join("; ");
      } else {
        detail = (await response.text()).trim();
      }
    } catch {
      detail = "";
    }
    return detail ? `${prefix} (${response.status}): ${detail}` : `${prefix} (${response.status})`;
  }

  async readRemoteState(id, token = "") {
    const response = await this.githubApiRequest(`/gists/${encodeURIComponent(id)}`, { method: "GET" }, token);
    if (!response.ok) throw new Error(`Remote fetch failed (${response.status})`);
    const payload = await response.json();
    const file = payload?.files?.[CONFIG.GIST_FILENAME];
    const content = typeof file?.content === "string" ? file.content : "";
    if (!content) throw new Error("Remote state file missing");
    const parsed = this.parseRemoteDocument(JSON.parse(content));
    return { ...parsed, etag: response.headers.get("etag") };
  }

  async createRemoteState(snapshot, token = "") {
    if (!token) throw new Error("Save a GitHub token first.");
    const document = this.buildRemoteDocument(snapshot, 1);
    const content = JSON.stringify(document);
    if (content.length > CONFIG.MAX_REMOTE_PAYLOAD_BYTES) throw new Error("State is too large to sync.");
    const response = await this.githubApiRequest(
      "/gists",
      {
        method: "POST",
        body: JSON.stringify({
          description: "priority-task-app sync state",
          public: true,
          files: {
            [CONFIG.GIST_FILENAME]: { content },
          },
        }),
      },
      token
    );
    if (!response.ok) throw new Error(`Create sync link failed (${response.status})`);
    const payload = await response.json();
    const id = payload?.id;
    if (!id) throw new Error("Create sync link failed (missing id)");
    return { id, revision: 1, etag: response.headers.get("etag") };
  }

  async writeRemoteState(syncId, snapshot, expectedRevision, token = "") {
    if (!syncId) throw new Error("Missing sync id.");
    if (!token) throw new Error("Save a GitHub token first.");
    const latest = await this.readRemoteState(syncId, token);
    const knownRevision = Math.max(0, Number(expectedRevision) || 0);
    if (latest.revision !== knownRevision) {
      const err = new Error("Conflict (revision mismatch)");
      err.code = "conflict";
      err.latest = latest;
      throw err;
    }
    const nextRevision = knownRevision + 1;
    const document = this.buildRemoteDocument(snapshot, nextRevision);
    const content = JSON.stringify(document);
    if (content.length > CONFIG.MAX_REMOTE_PAYLOAD_BYTES) throw new Error("State is too large to sync.");
    const response = await this.githubApiRequest(
      `/gists/${encodeURIComponent(syncId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          files: {
            [CONFIG.GIST_FILENAME]: { content },
          },
        }),
      },
      token
    );
    if (response.status === 409 || response.status === 412) {
      const err = new Error(`Conflict (${response.status})`);
      err.code = "conflict";
      throw err;
    }
    if (!response.ok) throw new Error(await this.buildGithubApiError(response, "Remote save failed"));
    return { revision: nextRevision, etag: response.headers.get("etag") };
  }
}

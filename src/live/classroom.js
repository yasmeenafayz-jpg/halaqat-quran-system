import {
  getLiveRoom,
  joinLiveRoom,
  createLiveRoom,
  getOrCreateLiveRoom,
  listRoomHosts,
  assignRoomHost,
  assignRoomCohost,
  updateRoomCohost,
  revokeRoomHost,
  revokeRoomCohost,
  moderateLiveRoom,
  registerForSession,
  cancelSessionRegistration,
  getSessionRegistration,
  manageRegistrationWindow,
  manageSessionTurn,
  getLiveBoard,
  updateLiveBoard,
  clearLiveBoard,
  lockLiveBoard,
  unlockLiveBoard,
  getQuranAnnotations,
  saveQuranAnnotation,
  deleteQuranAnnotation,
  getQuranResources,
  saveQuranResource,
  deleteQuranResource,
  getSessionMaterials,
  createSessionMaterial,
  updateSessionMaterial,
  deleteSessionMaterial
} from "./live-room-api.js";

import { Room, RoomEvent, Track } from "livekit-client";

const SESSION_TYPES = Object.freeze({
  quran: "قرآن",
  group: "حلقة جماعية",
  individual: "حلقة فردية",
  trial: "جلسة تجريبية",
  test: "اختبار",
  noorani: "القاعدة النورانية",
  tafsir: "تفسير",
  fiqh: "فقه",
  hadith: "حديث",
  sirah: "سيرة",
  scientific: "مادة علمية",
  independent_recitation: "تسميع مستقل"
});

const CONNECTION_STATUS = Object.freeze({
  connecting: "جارٍ الاتصال",
  connected: "متصل",
  reconnecting: "إعادة الاتصال",
  disconnected: "غير متصل",
  removed: "تمت إزالته"
});

const MEDIA_ROLES = Object.freeze({
  listener: "مستمع",
  speaker: "متحدث"
});

function normalizeId(value, errorCode = "SESSION_ID_REQUIRED") {
  const id = Number(value);

  if (!Number.isInteger(id) || id < 1) {
    throw new Error(errorCode);
  }

  return id;
}

function normalizeUser(user = {}) {
  return {
    ...user,
    id: Number(user.id || 0),
    student_id: user.student_id
      ? Number(user.student_id)
      : null,
    teacher_id: user.teacher_id
      ? Number(user.teacher_id)
      : null
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;

  if (hours > 0) {
    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(remaining).padStart(2, "0")
    ].join(":");
  }

  return [
    String(minutes).padStart(2, "0"),
    String(remaining).padStart(2, "0")
  ].join(":");
}

function participantName(participant) {
  return (
    participant?.full_name ||
    participant?.student_name ||
    participant?.teacher_name ||
    participant?.user_name ||
    `مشارك #${participant?.id ?? "—"}`
  );
}

export class Classroom {
  constructor(options = {}) {
    this.options = {
      root: options.root || null,
      sessionId: options.sessionId || null,
      user: normalizeUser(options.user || {})
    };

    this.root = this.options.root;

    this.state = {
      session: null,
      room: null,
      participants: [],
      registration: null,
      classroom: {
        selectedStudentId: null,
        attendance: [],
        wird: null,
        evaluations: {},
        panel: "students",
        activeTurnStudentId: null,
        turnStartedAt: null,
        recitationStatus: {},
        materials: [],
        materialsLoading: false,
        materialSaving: false,
        materialEditorId: null,
        loading: false
      },
      recording: null,
      hosts: {
        list: [],
        allowedPermissions: [],
        staff: [],
        loading: false,
        staffLoading: false,
        editorUserId: null
      },
      board: {
        state: {
          pages: [
            {
              id: 1,
              title: "السبورة",
              elements: []
            }
          ],
          activePageId: 1
        },
        locked: false,
        tool: "pen",
        color: "#111827",
        size: 3,
        history: [],
        future: []
      },
      quran: {
        studentId: null,
        ayahId: null,
        surahName: "",
        ayahText: "",
        annotations: [],
        mode: "student",
        resourceType: "tafsir",
        resources: [],
        resourceLoading: false,
        loading: false
      },
      loading: false,
      error: null,
      notice: null,
      joined: false,
      elapsedSeconds: 0
    };
    this.liveKitRoom = null;
    this.liveKitToken = null;
    this.liveKitServerUrl = null;
    this.liveKitConnected = false;
    this.liveKitCanPublish = false;
    this.liveKitHandlersBound = null;
    this.liveKitTrackElements = new Map();

    this.refreshTimer = null;
    this.clockTimer = null;
  }

  get sessionId() {
    return normalizeId(this.options.sessionId);
  }

  setState(patch = {}) {
    this.state = {
      ...this.state,
      ...patch
    };

    this.render();
  }

  getSessionTitle() {
    const session = this.state.session;

    return (
      session?.title ||
      session?.name ||
      SESSION_TYPES[session?.session_type] ||
      "الفصل الحي"
    );
  }

  getSessionTime() {
    const session = this.state.session;

    if (!session) {
      return "";
    }

    if (session.start_time && session.end_time) {
      return `${session.start_time} — ${session.end_time}`;
    }

    return session.start_time || "";
  }

  getActiveSpeakerCount() {
    return this.state.participants.filter(
      (participant) =>
        participant?.connection_status === "connected" &&
        participant?.media_role === "speaker"
    ).length;
  }

  getRoomStatus() {
    return String(
      this.state.room?.status || "unknown"
    );
  }

  getRoomStatusLabel() {
    const labels = {
      ready: "جاهزة",
      open: "مفتوحة",
      closed: "مغلقة",
      ended: "انتهت",
      disabled: "معطلة",
      unknown: "غير معروفة"
    };

    return (
      labels[this.getRoomStatus()] ||
      labels.unknown
    );
  }

  getParticipantCount() {
    return this.state.participants.filter(
      (participant) =>
        participant?.connection_status !== "removed"
    ).length;
  }

  getConnectedParticipantCount() {
    return this.state.participants.filter(
      (participant) =>
        participant?.connection_status === "connected" ||
        participant?.connection_status === "reconnecting"
    ).length;
  }

  getMyRegistration() {
    const user = this.options.user || {};
    const studentId = Number(
      user?.student_id ||
      user?.studentId ||
      0
    );

    if (!studentId) {
      return null;
    }

    const registration =
      this.state.registration || {};

    const registrations =
      Array.isArray(registration?.registrations)
        ? registration.registrations
        : [];

    return (
      registrations.find(
        (item) =>
          Number(item?.student_id) === studentId
      ) || null
    );
  }

  getMyTurn() {
    const registration =
      this.getMyRegistration();

    if (!registration) {
      return null;
    }

    const state =
      this.state.registration || {};

    const turns =
      Array.isArray(state?.turns)
        ? state.turns
        : [];

    return (
      turns.find(
        (turn) =>
          Number(turn?.registration_id) ===
          Number(registration?.id)
      ) || null
    );
  }

  getRegistrationWindowStatus() {
    const registration =
      this.state.registration || {};

    return String(
      registration?.window?.status ||
      registration?.registration_window?.status ||
      "unknown"
    );
  }

  getRegistrationWindowLabel() {
    const labels = {
      scheduled: "مجدولة",
      open: "مفتوحة",
      closed: "مغلقة",
      cancelled: "ملغاة",
      unknown: "غير متاحة"
    };

    const status =
      this.getRegistrationWindowStatus();

    return labels[status] || labels.unknown;
  }

  canModerate() {
    const user = this.options.user;

    return (
      user?.role === "admin" ||
      user?.role === "supervisor" ||
      user?.role === "teacher" ||
      Array.isArray(user?.roles) &&
      (
        user.roles.includes("admin") ||
        user.roles.includes("supervisor") ||
        user.roles.includes("teacher")
      )
    );
  }

  canManageHostDelegation() {
    const user = this.options.user || {};

    return (
      user?.role === "admin" ||
      user?.role === "supervisor" ||
      user?.role === "teacher" ||
      Array.isArray(user?.roles) &&
      (
        user.roles.includes("admin") ||
        user.roles.includes("supervisor") ||
        user.roles.includes("teacher")
      )
    );
  }

  async loadHostStaff() {
    if (!this.canManageHostDelegation()) {
      return [];
    }

    this.state.hosts.staffLoading = true;

    try {
      const response = await fetch("/api/teachers?status=active", {
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error("TEACHERS_FETCH_FAILED");
      }

      const data = await response.json();

      const teachers =
        Array.isArray(data?.data)
          ? data.data
          : [];

      this.state.hosts.staff = teachers
        .filter(
          (teacher) =>
            Number(teacher?.user_id) > 0
        );

      return this.state.hosts.staff;
    } finally {
      this.state.hosts.staffLoading = false;
    }
  }

  async loadRoomHosts() {
    if (
      !this.sessionId ||
      !this.state.room?.id ||
      !this.canManageHostDelegation()
    ) {
      return null;
    }

    this.state.hosts.loading = true;

    try {
      const data = await listRoomHosts(this.sessionId);

      await this.loadHostStaff();

      this.state.hosts.list =
        Array.isArray(data?.hosts)
          ? data.hosts
          : [];

      this.state.hosts.allowedPermissions =
        Array.isArray(data?.allowed_cohost_permissions)
          ? data.allowed_cohost_permissions
          : [];

      return data;
    } finally {
      this.state.hosts.loading = false;
    }
  }

  getRoomHostByUserId(userId) {
    const id = Number(userId || 0);

    return (
      this.state.hosts?.list || []
    ).find(
      (host) =>
        Number(host?.user_id) === id &&
        host?.status === "active"
    ) || null;
  }

  async assignHost(userId) {
    if (!this.canManageHostDelegation()) {
      throw new Error("HOST_MANAGEMENT_FORBIDDEN");
    }

    this.state.loading = true;
    this.state.error = null;

    try {
      const data = await assignRoomHost(
        this.sessionId,
        userId
      );

      await this.loadRoomHosts();

      this.state.notice = "تم تعيين المضيف";
      return data;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  async assignCohost(userId, permissions = []) {
    if (!this.canManageHostDelegation()) {
      throw new Error("HOST_MANAGEMENT_FORBIDDEN");
    }

    this.state.loading = true;
    this.state.error = null;

    try {
      const data = await assignRoomCohost(
        this.sessionId,
        userId,
        permissions
      );

      await this.loadRoomHosts();

      this.state.notice = "تم تعيين المساعد";
      return data;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  async updateCohost(userId, permissions = []) {
    if (!this.canManageHostDelegation()) {
      throw new Error("HOST_MANAGEMENT_FORBIDDEN");
    }

    this.state.loading = true;
    this.state.error = null;

    try {
      const data = await updateRoomCohost(
        this.sessionId,
        userId,
        permissions
      );

      await this.loadRoomHosts();

      this.state.notice = "تم تحديث صلاحيات المساعد";
      return data;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  async revokeHost(userId) {
    if (!this.canManageHostDelegation()) {
      throw new Error("HOST_MANAGEMENT_FORBIDDEN");
    }

    this.state.loading = true;
    this.state.error = null;

    try {
      const data = await revokeRoomHost(
        this.sessionId,
        userId
      );

      await this.loadRoomHosts();

      this.state.notice = "تم سحب صلاحية المضيف";
      return data;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  async revokeCohost(userId) {
    if (!this.canManageHostDelegation()) {
      throw new Error("HOST_MANAGEMENT_FORBIDDEN");
    }

    this.state.loading = true;
    this.state.error = null;

    try {
      const data = await revokeRoomCohost(
        this.sessionId,
        userId
      );

      await this.loadRoomHosts();

      this.state.notice = "تم سحب صلاحية المساعد";
      return data;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  renderHostManagement() {
    if (!this.canManageHostDelegation()) {
      return "";
    }

    const hosts =
      Array.isArray(this.state.hosts?.list)
        ? this.state.hosts.list
        : [];

    const staff =
      Array.isArray(this.state.hosts?.staff)
        ? this.state.hosts.staff
        : [];

    const allowed =
      Array.isArray(this.state.hosts?.allowedPermissions)
        ? this.state.hosts.allowedPermissions
        : [];

    const activeHosts =
      hosts.filter(
        (host) => host?.status === "active"
      );

    const assignedUserIds =
      new Set(
        activeHosts.map(
          (host) => Number(host?.user_id)
        )
      );

    const permissionLabels = {
      participant_moderate: "إدارة المشاركين",
      turn_manage: "إدارة أدوار التسميع",
      room_manage: "إدارة الفصل",
      registration_manage: "إدارة التسجيل",
      board_manage: "إدارة السبورة",
      quran_manage: "إدارة المصحف",
      materials_manage: "إدارة المواد العلمية"
    };

    const permissionCheckboxes = (selected = []) =>
      allowed.map((permission) => `
        <label class="live-host-permission">
          <input
            type="checkbox"
            value="${escapeHtml(permission)}"
            data-live-host-permission
            ${selected.includes(permission) ? "checked" : ""}
          >
          <span>
            ${escapeHtml(
              permissionLabels[permission] || permission
            )}
          </span>
        </label>
      `).join("");

    const availableStaff =
      staff.filter(
        (teacher) =>
          !assignedUserIds.has(
            Number(teacher?.user_id)
          )
      );

    const staffOptions =
      availableStaff.length
        ? availableStaff.map((teacher) => `
            <option value="${Number(teacher.user_id)}">
              ${escapeHtml(
                String(
                  teacher.full_name ||
                  teacher.teacher_code ||
                  "معلم"
                )
              )}
            </option>
          `).join("")
        : `
            <option value="">
              لا يوجد معلمون متاحون
            </option>
          `;

    const rows =
      activeHosts.length
        ? activeHosts.map((host) => {
            const userId =
              Number(host?.user_id || 0);

            const role =
              host?.host_role === "host"
                ? "مضيف Host"
                : "مساعد Co-host";

            const permissions =
              Array.isArray(host?.permissions)
                ? host.permissions
                : [];

            const permissionText =
              host?.host_role === "host"
                ? "صلاحيات المضيف الكاملة"
                : permissions.length
                  ? permissions
                      .map(
                        (item) =>
                          permissionLabels[item] || item
                      )
                      .join("، ")
                  : "بدون صلاحيات مفوضة";

            return `
              <div class="live-host-row">
                <strong>
                  ${escapeHtml(
                    String(host?.full_name || "مستخدم")
                  )}
                </strong>

                <span>
                  ${escapeHtml(role)}
                </span>

                <small>
                  ${escapeHtml(permissionText)}
                </small>

                <div class="live-host-actions">
                  ${
                    host?.host_role === "host"
                      ? `
                        <button
                          type="button"
                          data-live-host-action="revoke-host"
                          data-host-user-id="${userId}">
                          سحب Host
                        </button>
                      `
                      : `
                        <button
                          type="button"
                          data-live-host-action="edit-cohost"
                          data-host-user-id="${userId}">
                          تعديل الصلاحيات
                        </button>

                        <button
                          type="button"
                          data-live-host-action="revoke-cohost"
                          data-host-user-id="${userId}">
                          سحب Co-host
                        </button>
                      `
                  }
                </div>

                ${
                  this.state.hosts?.editorUserId === userId &&
                  host?.host_role === "cohost"
                    ? `
                      <div class="live-host-editor">
                        <strong>صلاحيات Co-host</strong>

                        <div class="live-host-permissions">
                          ${permissionCheckboxes(permissions)}
                        </div>

                        <div class="live-host-actions">
                          <button
                            type="button"
                            data-live-host-action="save-cohost"
                            data-host-user-id="${userId}">
                            حفظ الصلاحيات
                          </button>

                          <button
                            type="button"
                            data-live-host-action="cancel-edit-cohost">
                            إلغاء
                          </button>
                        </div>
                      </div>
                    `
                    : ""
                }
              </div>
            `;
          }).join("")
        : `
            <span>
              لا توجد صلاحيات Host أو Co-host حالية.
            </span>
          `;

    return `
      <div class="live-control-group">
        <strong>المضيف والمساعدون</strong>

        ${rows}

        <div class="live-host-add">
          <label>
            إضافة Host
            <select data-live-host-select>
              <option value="">اختر المعلم</option>
              ${staffOptions}
            </select>
          </label>

          <button
            type="button"
            data-live-host-action="assign-host">
            تعيين Host
          </button>
        </div>

        <div class="live-host-add">
          <label>
            إضافة Co-host
            <select data-live-cohost-select>
              <option value="">اختر المعلم</option>
              ${staffOptions}
            </select>
          </label>

          <div class="live-host-permissions" data-live-cohost-permissions>
            ${permissionCheckboxes([])}
          </div>

          <button
            type="button"
            data-live-host-action="assign-cohost">
            تعيين Co-host
          </button>
        </div>

        ${
          this.state.hosts?.staffLoading
            ? `<small>جارٍ تحميل قائمة المعلمين…</small>`
            : ""
        }
      </div>
    `;
  }

  canRecord() {
    // التسجيل الصوتي غير مستخدم في أكاديمية الأوَّابين.
    // لا تسمح الواجهة الأمامية بأي عملية تسجيل.
    return false;
  }

  async joinSession() {
    const user = this.options.user || {};
    const isModerator = this.canModerate();

    if (!isModerator && !user?.student_id) {
      throw new Error("STUDENT_ID_REQUIRED");
    }

    this.setState({
      loading: true,
      error: null,
      notice: null
    });

    try {
      /*
       * الطلاب يدخلون من مسار الطالب المقيد في الحلقة
       * والمسجل في جلسة اليوم.
       *
       * المعلم/المشرف/المدير يدخلون من مسار إدارة الغرفة،
       * ولا يتم إرسال student_id لهم.
       */
      const data = isModerator
        ? await getOrCreateLiveRoom(this.sessionId)
        : await joinLiveRoom(
            this.sessionId,
            user.student_id
          );

      this.state.session =
        data?.session ||
        this.state.session;

      this.state.room =
        data?.room ||
        this.state.room;

      this.state.participants =
        Array.isArray(data?.participants)
          ? data.participants
          : this.state.participants;

      this.state.registration =
        data?.registration ||
        this.state.registration;

      this.state.joined = true;

      try {
        await this.connectLiveKit();
      } catch (liveKitError) {
        console.warn("LIVEKIT_CONNECT_FAILED", liveKitError);
        this.state.notice =
          "تم الدخول إلى الفصل، لكن الاتصال الصوتي والمرئي غير متاح حاليًا";
      }

      this.state.notice = isModerator
        ? "تم الدخول إلى إدارة الفصل الحي"
        : "تم الدخول إلى الفصل بنجاح";

      if (isModerator) {
        await this.loadRoomHosts();
      }

      return data;
    } catch (error) {
      this.state.error =
        error?.message ||
        "تعذر الدخول إلى الفصل";

      throw error;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  async createOrOpenRoom() {
    if (!this.canModerate()) {
      throw new Error("LIVE_ROOM_FORBIDDEN");
    }

    this.setState({
      loading: true,
      error: null,
      notice: null
    });

    try {
      const data = await getOrCreateLiveRoom(
        this.sessionId
      );

      this.state.session = data?.session || this.state.session;
      this.state.room = data?.room || this.state.room;

      if (Array.isArray(data?.participants)) {
        this.state.participants = data.participants;
      }

      await this.loadRoomHosts();

      this.state.notice = "تم تجهيز الفصل الحي";

      return data;
    } catch (error) {
      this.state.error =
        error?.message ||
        "تعذر تجهيز الفصل الحي";

      throw error;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  async refreshRegistration() {
    const data = await getSessionRegistration(
      this.sessionId
    );

    this.state.registration =
      data?.registration || data || null;

    if (Array.isArray(data?.registrations)) {
      this.state.registration.registrations =
        data.registrations;
    }

    if (Array.isArray(data?.turns)) {
      this.state.registration.turns =
        data.turns;
    }

    this.render();

    return data;
  }

  async register() {
    const user = this.options.user;

    if (!user?.student_id) {
      throw new Error("STUDENT_ID_REQUIRED");
    }

    this.setState({
      loading: true,
      error: null,
      notice: null
    });

    try {
      const data = await registerForSession(
        this.sessionId
      );

      this.state.registration =
        data?.registration ||
        data ||
        this.state.registration;

      this.state.notice =
        "تم تسجيل اسمك في قائمة التسميع";

      return data;
    } catch (error) {
      this.state.error =
        error?.message ||
        "تعذر تسجيل الاسم";

      throw error;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  async cancelRegistration() {
    this.setState({
      loading: true,
      error: null,
      notice: null
    });

    try {
      const data =
        await cancelSessionRegistration(
          this.sessionId
        );

      this.state.registration =
        data?.registration ||
        data ||
        this.state.registration;

      this.state.notice =
        "تم إلغاء التسجيل";

      return data;
    } catch (error) {
      this.state.error =
        error?.message ||
        "تعذر إلغاء التسجيل";

      throw error;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  async moderateParticipant(
    participantId,
    action
  ) {
    if (!this.canModerate()) {
      throw new Error("LIVE_ROOM_FORBIDDEN");
    }

    const participant = Number(participantId);

    if (!Number.isInteger(participant) || participant < 1) {
      throw new Error("PARTICIPANT_ID_REQUIRED");
    }

    if (!String(action || "").trim()) {
      throw new Error("LIVE_ROOM_ACTION_REQUIRED");
    }

    this.setState({
      loading: true,
      error: null,
      notice: null
    });

    try {
      const data = await moderateLiveRoom(
        this.sessionId,
        participant,
        action
      );

      if (Array.isArray(data?.participants)) {
        this.state.participants =
          data.participants;
      } else if (data?.participant) {
        const updated = data.participant;

        this.state.participants =
          this.state.participants.map((item) =>
            Number(item?.id) === participant
              ? {
                  ...item,
                  ...updated
                }
              : item
          );
      }

      this.state.notice =
        "تم تحديث صلاحية المشارك";

      return data;
    } catch (error) {
      this.state.error =
        error?.message ||
        "تعذر تحديث المشارك";

      throw error;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  async grantSpeaker(participantId) {
    return this.moderateParticipant(
      participantId,
      "grant_speaker"
    );
  }

  async revokeSpeaker(participantId) {
    return this.moderateParticipant(
      participantId,
      "revoke_speaker"
    );
  }

  async muteParticipant(participantId) {
    return this.moderateParticipant(
      participantId,
      "mute"
    );
  }

  async unmuteParticipant(participantId) {
    return this.moderateParticipant(
      participantId,
      "unmute"
    );
  }

  async disableParticipantCamera(participantId) {
    return this.moderateParticipant(
      participantId,
      "disable_camera"
    );
  }

  async enableParticipantCamera(participantId) {
    return this.moderateParticipant(
      participantId,
      "enable_camera"
    );
  }

  async reconnectParticipant(participantId) {
    return this.moderateParticipant(
      participantId,
      "reconnect"
    );
  }

  async removeParticipant(participantId) {
    return this.moderateParticipant(
      participantId,
      "remove"
    );
  }

  async manageWindow(action, data = {}) {
    if (!this.canModerate()) {
      throw new Error("SESSION_LIFECYCLE_FORBIDDEN");
    }

    this.setState({
      loading: true,
      error: null,
      notice: null
    });

    try {
      const result =
        await manageRegistrationWindow(
          this.sessionId,
          action,
          data
        );

      await this.refreshRegistration();

      this.state.notice =
        "تم تحديث نافذة التسجيل";

      return result;
    } catch (error) {
      this.state.error =
        error?.message ||
        "تعذر تحديث نافذة التسجيل";

      throw error;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  async manageTurn(
    action,
    turnId,
    data = {}
  ) {
    if (!this.canModerate()) {
      throw new Error("SESSION_TURN_FORBIDDEN");
    }

    this.setState({
      loading: true,
      error: null,
      notice: null
    });

    try {
      const result =
        await manageSessionTurn(
          this.sessionId,
          action,
          registrationId,
          data
        );

      await this.refreshRegistration();

      this.state.notice =
        "تم تحديث حالة الدور";

      return result;
    } catch (error) {
      this.state.error =
        error?.message ||
        "تعذر تحديث الدور";

      throw error;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  async load() {
    this.setState({
      loading: true,
      error: null,
      notice: null
    });

    try {
      const data = await getLiveRoom(this.sessionId);

      this.state.session = data?.session || null;
      this.state.room = data?.room || null;
      this.state.participants = Array.isArray(data?.participants)
        ? data.participants
        : [];

      this.state.registration = data?.registration || null;

      await this.loadRoomHosts();

      return data;
    } catch (error) {
      this.state.error =
        error?.message || "تعذر تحميل الفصل الحي";

      throw error;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }


  getLiveKitStage() {
    return this.root?.querySelector("#livekit-media-stage") || null;
  }

  async connectLiveKit() {
    if (this.liveKitConnected && this.liveKitRoom) {
      return this.liveKitRoom;
    }

    const tokenData = await getLiveKitToken(this.sessionId);

    const token =
      tokenData?.participant_token ||
      tokenData?.token ||
      "";

    const serverUrl =
      tokenData?.server_url ||
      tokenData?.url ||
      "";

    if (!token || !serverUrl) {
      throw new Error("LIVEKIT_TOKEN_INVALID");
    }

    this.liveKitToken = token;
    this.liveKitServerUrl = serverUrl;
    this.liveKitCanPublish =
      tokenData?.permissions?.can_publish !== false;

    const room = new Room();

    this.bindLiveKitEvents(room);

    await room.connect(serverUrl, token);

    this.liveKitRoom = room;
    this.liveKitConnected = true;

    await this.syncLiveKitMedia();

    return room;
  }

  bindLiveKitEvents(room) {
    if (!room || this.liveKitHandlersBound === room) {
      return;
    }

    this.liveKitHandlersBound = room;

    room.on(RoomEvent.Connected, () => {
      this.liveKitConnected = true;
      this.syncLiveKitMedia();
      this.render();
    });

    room.on(RoomEvent.Reconnected, () => {
      this.liveKitConnected = true;
      this.syncLiveKitMedia();
      this.render();
    });

    room.on(RoomEvent.Reconnecting, () => {
      this.liveKitConnected = false;
      this.render();
    });

    room.on(RoomEvent.Disconnected, () => {
      this.liveKitConnected = false;
      this.render();
    });

    room.on(
      RoomEvent.TrackSubscribed,
      (track, publication, participant) => {
        this.attachLiveKitTrack(
          track,
          participant?.identity || "participant",
          publication?.trackSid || track?.sid || ""
        );
      }
    );

    room.on(
      RoomEvent.TrackUnsubscribed,
      (track, publication, participant) => {
        this.detachLiveKitTrack(
          participant?.identity || "participant",
          publication?.trackSid || track?.sid || ""
        );
      }
    );

    room.on(RoomEvent.LocalTrackPublished, () => {
      this.syncLiveKitMedia();
    });

    room.on(RoomEvent.LocalTrackUnpublished, () => {
      this.syncLiveKitMedia();
    });

    room.on(RoomEvent.ParticipantConnected, () => {
      this.syncLiveKitMedia();
      this.render();
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      const identity = participant?.identity || "";

      for (const [key, element] of this.liveKitTrackElements.entries()) {
        if (key.startsWith(identity + ":")) {
          element?.remove?.();
          this.liveKitTrackElements.delete(key);
        }
      }

      this.render();
    });

    room.on(RoomEvent.TokenExpiring, async () => {
      try {
        const refreshed = await getLiveKitToken(this.sessionId);
        const nextToken =
          refreshed?.participant_token ||
          refreshed?.token ||
          "";

        if (
          nextToken &&
          typeof room.updateToken === "function"
        ) {
          await room.updateToken(nextToken);
          this.liveKitToken = nextToken;
        }
      } catch (error) {
        console.warn("LIVEKIT_TOKEN_REFRESH_FAILED", error);
      }
    });
  }

  attachLiveKitTrack(track, identity, trackSid) {
    if (!track) {
      return;
    }

    const stage = this.getLiveKitStage();
    if (!stage) {
      return;
    }

    const key =
      identity + ":" +
      (trackSid || track.sid || track.kind);

    const old = this.liveKitTrackElements.get(key);

    if (old) {
      old.remove?.();
      this.liveKitTrackElements.delete(key);
    }

    const element = track.attach();

    element.dataset.livekitIdentity = identity;
    element.dataset.livekitTrackSid =
      trackSid || track.sid || "";

    element.className =
      track.kind === Track.Kind.Video
        ? "livekit-video-track"
        : "livekit-audio-track";

    stage.appendChild(element);
    this.liveKitTrackElements.set(key, element);
  }

  detachLiveKitTrack(identity, trackSid) {
    const key = identity + ":" + (trackSid || "");
    const element =
      this.liveKitTrackElements.get(key);

    if (element) {
      element.remove?.();
      this.liveKitTrackElements.delete(key);
    }
  }

  async syncLiveKitMedia() {
    const room = this.liveKitRoom;

    if (!room) {
      return;
    }

    try {
      const local = room.localParticipant;

      if (local) {
        for (
          const publication of
          local.trackPublications?.values?.() || []
        ) {
          const track = publication?.track;

          if (track) {
            this.attachLiveKitTrack(
              track,
              local.identity || "me",
              publication.trackSid ||
                track.sid ||
                ""
            );
          }
        }
      }

      for (
        const participant of
        room.remoteParticipants?.values?.() || []
      ) {
        for (
          const publication of
          participant.trackPublications?.values?.() || []
        ) {
          const track = publication?.track;

          if (track) {
            this.attachLiveKitTrack(
              track,
              participant.identity || "participant",
              publication.trackSid ||
                track.sid ||
                ""
            );
          }
        }
      }
    } catch (error) {
      console.warn(
        "LIVEKIT_MEDIA_SYNC_FAILED",
        error
      );
    }
  }

  async setLiveKitMicrophone(enabled) {
    const room = this.liveKitRoom;

    if (!room?.localParticipant) {
      throw new Error("LIVEKIT_NOT_CONNECTED");
    }

    await room.localParticipant.setMicrophoneEnabled(
      Boolean(enabled)
    );

    await this.syncLiveKitMedia();
    this.render();
  }

  async setLiveKitCamera(enabled) {
    const room = this.liveKitRoom;

    if (!room?.localParticipant) {
      throw new Error("LIVEKIT_NOT_CONNECTED");
    }

    await room.localParticipant.setCameraEnabled(
      Boolean(enabled)
    );

    await this.syncLiveKitMedia();
    this.render();
  }

  disconnectLiveKit() {
    const room = this.liveKitRoom;

    for (
      const element of
      this.liveKitTrackElements.values()
    ) {
      element?.remove?.();
    }

    this.liveKitTrackElements.clear();

    if (room) {
      room.disconnect();
    }

    this.liveKitRoom = null;
    this.liveKitToken = null;
    this.liveKitServerUrl = null;
    this.liveKitConnected = false;
    this.liveKitCanPublish = false;
    this.liveKitHandlersBound = null;
  }

  async mount() {
    if (!this.options.root) {
      throw new Error("CLASSROOM_ROOT_REQUIRED");
    }

    this.render();
    this.bindControls();

    await this.load();

    await this.loadBoard();

    await this.loadClassroomCore();

    this.startTimers();

    return this;
  }

  destroy() {
    this.disconnectLiveKit();
    this.unbindControls();

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }

    if (this.options.root) {
      this.options.root.innerHTML = "";
    }
  }

  startTimers() {
    this.destroyTimers();

    this.refreshTimer = setInterval(() => {
      this.load().catch(() => {});
    }, 15000);

    this.clockTimer = setInterval(() => {
      this.state.elapsedSeconds += 1;

      const timer = this.options.root?.querySelector(
        "[data-classroom-timer]"
      );

      if (timer) {
        timer.textContent = formatDuration(
          this.state.elapsedSeconds
        );
      }
    }, 1000);
  }

  destroyTimers() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }


  async loadBoard() {
    try {
      const data = await getLiveBoard(this.sessionId);

      if (data?.board?.state) {
        this.state.board.state = data.board.state;
        this.state.board.locked =
          data.board.status === "locked";
      }

      this.render();
    } catch {
      /*
       * Board is optional during room initialization.
       * Do not block the live classroom if it is unavailable.
       */
    }
  }

  getActiveBoardPage() {
    const state = this.state.board.state;

    if (!Array.isArray(state.pages)) {
      state.pages = [
        {
          id: 1,
          title: "السبورة",
          elements: []
        }
      ];
    }

    let page = state.pages.find(
      (item) => Number(item.id) === Number(state.activePageId)
    );

    if (!page) {
      page = state.pages[0];
      state.activePageId = page.id;
    }

    if (!Array.isArray(page.elements)) {
      page.elements = [];
    }

    return page;
  }

  async saveBoard() {
    if (this.state.board.locked) {
      return;
    }

    try {
      await updateLiveBoard(
        this.sessionId,
        this.state.board.state
      );
    } catch {
      this.state.error = "تعذر حفظ السبورة";
    }
  }

  async boardClear() {
    if (this.state.board.locked) return;

    const page = this.getActiveBoardPage();

    this.state.board.history.push(
      JSON.stringify(page.elements)
    );

    this.state.board.future = [];
    page.elements = [];

    await clearLiveBoard(this.sessionId);
    this.render();
  }

  async boardLock() {
    await lockLiveBoard(this.sessionId);

    this.state.board.locked = true;
    this.render();
  }

  async boardUnlock() {
    await unlockLiveBoard(this.sessionId);

    this.state.board.locked = false;
    this.render();
  }

  boardSetTool(tool) {
    if (this.state.board.locked) return;

    this.state.board.tool = String(tool || "pen");
    this.render();
  }

  boardUndo() {
    if (this.state.board.locked) return;

    const page = this.getActiveBoardPage();

    if (!this.state.board.history.length) {
      return;
    }

    this.state.board.future.push(
      JSON.stringify(page.elements)
    );

    page.elements =
      JSON.parse(
        this.state.board.history.pop()
      );

    this.saveBoard();
    this.render();
  }

  boardRedo() {
    if (this.state.board.locked) return;

    const page = this.getActiveBoardPage();

    if (!this.state.board.future.length) {
      return;
    }

    this.state.board.history.push(
      JSON.stringify(page.elements)
    );

    page.elements =
      JSON.parse(
        this.state.board.future.pop()
      );

    this.saveBoard();
    this.render();
  }

  boardAddText() {
    if (this.state.board.locked) return;

    const text = window.prompt("النص على السبورة:");
    if (!text) return;

    const page = this.getActiveBoardPage();

    this.state.board.history.push(
      JSON.stringify(page.elements)
    );

    page.elements.push({
      id: `text-${Date.now()}`,
      type: "text",
      text: String(text),
      x: 180,
      y: 150,
      size: 28
    });

    this.state.board.future = [];
    this.saveBoard();
    this.render();
  }

  boardAddShape(type) {
    if (this.state.board.locked) return;

    const page = this.getActiveBoardPage();

    this.state.board.history.push(
      JSON.stringify(page.elements)
    );

    page.elements.push({
      id: `${type}-${Date.now()}`,
      type,
      x: 160,
      y: 120,
      width: 180,
      height: 100,
      stroke: this.state.board.color,
      size: this.state.board.size
    });

    this.state.board.future = [];
    this.saveBoard();
    this.render();
  }

  boardAddPage() {
    if (this.state.board.locked) return;

    const pages = this.state.board.state.pages;

    const id =
      pages.reduce(
        (max, page) => Math.max(max, Number(page.id) || 0),
        0
      ) + 1;

    pages.push({
      id,
      title: `صفحة ${id}`,
      elements: []
    });

    this.state.board.state.activePageId = id;

    this.saveBoard();
    this.render();
  }

  boardSelectPage(id) {
    if (this.state.board.locked) return;

    this.state.board.state.activePageId =
      Number(id);

    this.render();
  }

  renderBoard() {
    const board = this.state.board;
    const page = this.getActiveBoardPage();

    const elements = page.elements.map((element) => {
      if (element.type === "text") {
        return `
          <div
            class="aw-board-text"
            style="
              left:${Number(element.x || 0)}px;
              top:${Number(element.y || 0)}px;
              font-size:${Number(element.size || 28)}px;
            "
          >${escapeHtml(element.text)}</div>
        `;
      }

      if (
        element.type === "rectangle" ||
        element.type === "circle"
      ) {
        return `
          <div
            class="aw-board-shape aw-board-${escapeHtml(element.type)}"
            style="
              left:${Number(element.x || 0)}px;
              top:${Number(element.y || 0)}px;
              width:${Number(element.width || 100)}px;
              height:${Number(element.height || 80)}px;
              border-width:${Number(element.size || 3)}px;
              border-color:${escapeHtml(element.stroke || "#111827")};
            "
          ></div>
        `;
      }

      return "";
    }).join("");

    const pages = board.state.pages.map((item) => `
      <button
        type="button"
        class="secondary-button aw-board-page-button"
        data-board-action="page"
        data-board-page="${Number(item.id)}"
      >
        ${escapeHtml(item.title || `صفحة ${item.id}`)}
      </button>
    `).join("");

    return `
      <section class="aw-board">
        <header class="aw-board-header">
          <div>
            <strong>السبورة التفاعلية</strong>
            <small>مرتبطة بهذه الجلسة</small>
          </div>

          <div class="aw-board-status">
            ${board.locked ? "🔒 مقفلة" : "🟢 قابلة للتحرير"}
          </div>
        </header>

        <div class="aw-board-toolbar">
          <button
            type="button"
            class="secondary-button"
            data-board-action="tool"
            data-board-tool="pen"
            ${board.locked ? "disabled" : ""}
          >✎ قلم</button>

          <button
            type="button"
            class="secondary-button"
            data-board-action="text"
            ${board.locked ? "disabled" : ""}
          >T نص</button>

          <button
            type="button"
            class="secondary-button"
            data-board-action="shape"
            data-board-shape="rectangle"
            ${board.locked ? "disabled" : ""}
          >▭ مستطيل</button>

          <button
            type="button"
            class="secondary-button"
            data-board-action="shape"
            data-board-shape="circle"
            ${board.locked ? "disabled" : ""}
          >○ دائرة</button>

          <button
            type="button"
            class="secondary-button"
            data-board-action="undo"
            ${board.locked ? "disabled" : ""}
          >↶ تراجع</button>

          <button
            type="button"
            class="secondary-button"
            data-board-action="redo"
            ${board.locked ? "disabled" : ""}
          >↷ إعادة</button>

          <button
            type="button"
            class="secondary-button"
            data-board-action="clear"
            ${board.locked ? "disabled" : ""}
          >مسح</button>

          ${
            board.locked
              ? `
                <button
                  type="button"
                  class="primary-button"
                  data-board-action="unlock"
                >🔓 فتح السبورة</button>
              `
              : `
                <button
                  type="button"
                  class="secondary-button"
                  data-board-action="lock"
                >🔒 قفل السبورة</button>
              `
          }
        </div>

        <div class="aw-board-pages">
          ${pages}

          <button
            type="button"
            class="primary-button"
            data-board-action="add-page"
            ${board.locked ? "disabled" : ""}
          >+ صفحة</button>
        </div>

        <div class="aw-board-canvas" data-board-canvas>
          <div class="aw-board-grid"></div>
          ${elements}

          ${
            !elements
              ? `<div class="aw-board-empty">ابدأ الكتابة أو الرسم هنا</div>`
              : ""
          }
        </div>
      </section>
    `;
  }





  getClassroomTurn(studentId) {
    const id = Number(studentId);

    const registrations =
      Array.isArray(this.state.registration?.registrations)
        ? this.state.registration.registrations
        : [];

    const turns =
      Array.isArray(this.state.registration?.turns)
        ? this.state.registration.turns
        : [];

    const registration = registrations.find(
      (item) =>
        Number(item?.student_id) === id
    );

    if (!registration) {
      return null;
    }

    return (
      turns.find(
        (item) =>
          Number(item?.registration_id) ===
          Number(registration.id)
      ) || null
    );
  }

  async classroomStartTurn(studentId) {
    const id = Number(studentId);

    if (!Number.isInteger(id) || id < 1) {
      throw new Error("STUDENT_ID_REQUIRED");
    }

    const turn = this.getClassroomTurn(id);

    if (!turn?.id) {
      throw new Error("TURN_NOT_FOUND");
    }

    /*
     * The backend uses strict transitions:
     * waiting -> called -> reciting
     */
    if (turn.status === "waiting") {
      await this.manageTurn(
        "call_turn",
        Number(turn.id)
      );
    }

    const freshTurn = this.getClassroomTurn(id);

    if (
      freshTurn?.status === "called"
    ) {
      await this.manageTurn(
        "start_turn",
        Number(freshTurn.id)
      );
    }

    this.state.classroom.activeTurnStudentId = id;
    this.state.classroom.turnStartedAt =
      new Date().toISOString();

    this.state.classroom.recitationStatus = {
      ...this.state.classroom.recitationStatus,
      [id]: "in_progress"
    };

    this.state.classroom.selectedStudentId = id;

    const student = this.getClassroomStudent(id);

    if (student) {
      this.state.quran.studentId =
        Number(
          student.student_id ||
          student.studentId ||
          student.id
        ) || null;
    }

    this.state.notice =
      `بدأ دور ${this.getStudentDisplayName(id)}`;

    this.render();
  }

  async classroomFinishTurn(
    studentId,
    status = "completed"
  ) {
    const id = Number(studentId);

    if (!Number.isInteger(id) || id < 1) {
      throw new Error("STUDENT_ID_REQUIRED");
    }

    const turn = this.getClassroomTurn(id);

    if (!turn?.id) {
      throw new Error("TURN_NOT_FOUND");
    }

    const action =
      status === "completed"
        ? "complete_turn"
        : "skip_turn";

    await this.manageTurn(
      action,
      Number(turn.id)
    );

    this.state.classroom.recitationStatus = {
      ...this.state.classroom.recitationStatus,
      [id]: status
    };

    if (
      Number(
        this.state.classroom.activeTurnStudentId
      ) === id
    ) {
      this.state.classroom.activeTurnStudentId = null;
      this.state.classroom.turnStartedAt = null;
    }

    this.state.notice =
      status === "completed"
        ? "تم إنهاء دور الطالب"
        : "تم تخطي دور الطالب";

    await this.refreshRegistration();
    this.render();
  }

  classroomOpenStudentQuran(studentId) {
    const id = Number(studentId);

    if (!id) {
      return;
    }

    this.classroomSelectStudent(id);

    this.state.quran.mode = "student";

    this.render();

    queueMicrotask(() => {
      this.loadQuranAnnotations();
      this.loadQuranResources();
    });
  }

  classroomOpenBoard() {
    this.state.notice =
      "السبورة جاهزة للعمل داخل الفصل";
    this.render();
  }

  classroomSetPanel(panel) {
    const allowed = [
      "students",
      "quran",
      "board",
      "materials",
      "evaluation"
    ];

    if (!allowed.includes(panel)) {
      return;
    }

    this.state.classroom.panel = panel;
    this.render();
  }

  async classroomOpenMaterials() {
    this.classroomSetPanel("materials");

    await this.loadClassroomMaterials();
  }

  async loadClassroomMaterials() {
    const sessionId = this.sessionId;

    if (!sessionId) {
      this.state.classroom.materials = [];
      return;
    }

    this.state.classroom.materialsLoading = true;
    this.render();

    try {
      const result =
        await getSessionMaterials(sessionId);

      this.state.classroom.materials =
        Array.isArray(result?.materials)
          ? result.materials
          : Array.isArray(result)
            ? result
            : [];

      this.state.classroom.materialsLoading = false;
      this.state.error = null;
    } catch (error) {
      this.state.classroom.materialsLoading = false;
      this.state.error =
        error?.message || "MATERIALS_LOAD_FAILED";
    }

    this.render();
  }

  canManageClassroomMaterials() {
    const user = this.options.user || {};

    if (
      user.role === "admin" ||
      user.role === "supervisor"
    ) {
      return true;
    }

    if (
      user.role === "teacher" &&
      user.teacher_id &&
      this.state.session?.teacher_id &&
      Number(user.teacher_id) ===
        Number(this.state.session.teacher_id)
    ) {
      return true;
    }

    const hosts =
      Array.isArray(this.state.hosts?.list)
        ? this.state.hosts.list
        : [];

    const current =
      hosts.find(
        (item) =>
          Number(
            item?.user_id ||
            item?.userId ||
            item?.id
          ) === Number(user.id)
      );

    if (
      current?.host_role === "cohost" &&
      Array.isArray(current?.permissions) &&
      current.permissions.includes("materials_manage")
    ) {
      return true;
    }

    if (
      current?.host_role === "cohost" &&
      typeof current?.permissions_json === "string"
    ) {
      try {
        const permissions =
          JSON.parse(current.permissions_json);

        return (
          Array.isArray(permissions) &&
          permissions.includes("materials_manage")
        );
      } catch {
        return false;
      }
    }

    return current?.host_role === "host";
  }

  getMaterialTypeLabel(type) {
    const labels = {
      lesson: "درس",
      tafsir: "تفسير",
      fiqh: "فقه",
      hadith: "حديث",
      sirah: "سيرة",
      noorani: "القاعدة النورانية",
      quran: "قرآن",
      document: "مستند",
      link: "رابط",
      note: "ملاحظة",
      other: "أخرى"
    };

    return labels[type] || "مادة علمية";
  }

  renderClassroomMaterials() {
    const classroom =
      this.state.classroom;

    const materials =
      Array.isArray(classroom.materials)
        ? classroom.materials
        : [];

    const canManage =
      this.canManageClassroomMaterials();

    if (classroom.materialsLoading) {
      return `
        <section class="aw-classroom-panel">
          <div class="aw-classroom-empty">
            جارٍ تحميل المواد العلمية...
          </div>
        </section>
      `;
    }

    const items = materials.map((material) => {
      const title =
        escapeHtml(material?.title || "بدون عنوان");

      const type =
        this.getMaterialTypeLabel(
          material?.material_type
        );

      const content =
        material?.content
          ? `<p>${escapeHtml(material.content)}</p>`
          : "";

      const link =
        material?.external_url
          ? `
            <a
              href="${escapeHtml(material.external_url)}"
              target="_blank"
              rel="noopener noreferrer"
              class="secondary-button"
            >
              فتح الرابط
            </a>
          `
          : "";

      const document =
        material?.document_id
          ? `
            <span class="aw-classroom-material-meta">
              مستند #${Number(material.document_id)}
            </span>
          `
          : "";

      const quran =
        material?.quran_ayah_id
          ? `
            <span class="aw-classroom-material-meta">
              آية #${Number(material.quran_ayah_id)}
            </span>
          `
          : "";

      const actions =
        canManage
          ? `
            <div class="aw-classroom-material-actions">
              <button
                type="button"
                class="secondary-button"
                data-classroom-action="edit-material"
                data-material-id="${Number(material.id)}"
              >
                تعديل
              </button>

              <button
                type="button"
                class="secondary-button"
                data-classroom-action="delete-material"
                data-material-id="${Number(material.id)}"
              >
                أرشفة
              </button>
            </div>
          `
          : "";

      return `
        <article class="aw-classroom-material">
          <div class="aw-classroom-material-head">
            <div>
              <strong>${title}</strong>
              <span>${escapeHtml(type)}</span>
            </div>
          </div>

          ${content}

          <div class="aw-classroom-material-meta-row">
            ${document}
            ${quran}
          </div>

          <div class="aw-classroom-material-actions">
            ${link}
            ${actions}
          </div>
        </article>
      `;
    }).join("");

    return `
      <section class="aw-classroom-panel aw-classroom-materials-panel">
        <header class="aw-classroom-panel-header">
          <div>
            <h3>المواد العلمية</h3>
            <p>
              المواد المرتبطة بهذه الجلسة فقط
            </p>
          </div>

          <div class="aw-classroom-panel-actions">
            <button
              type="button"
              class="secondary-button"
              data-classroom-action="refresh-materials"
            >
              تحديث
            </button>

            ${
              canManage
                ? `
                  <button
                    type="button"
                    class="primary-button"
                    data-classroom-action="add-material"
                  >
                    إضافة مادة
                  </button>
                `
                : ""
            }
          </div>
        </header>

        ${
          classroom.materialEditorId !== null
            ? this.renderMaterialEditor(
                materials.find(
                  (item) =>
                    Number(item.id) ===
                    Number(classroom.materialEditorId)
                ) || null
              )
            : ""
        }

        ${
          items
            ? items
            : `<div class="aw-classroom-empty">
                لا توجد مواد علمية مضافة لهذه الجلسة.
              </div>`
        }
      </section>
    `;
  }

  renderMaterialEditor(material = null) {
    if (!this.canManageClassroomMaterials()) {
      return "";
    }

    const editing = Boolean(material);

    return `
      <form
        class="aw-classroom-material-editor"
        data-classroom-material-form
      >
        <input
          type="hidden"
          name="id"
          value="${editing ? Number(material.id) : ""}"
        />

        <label>
          عنوان المادة
          <input
            type="text"
            name="title"
            required
            maxlength="200"
            value="${escapeHtml(material?.title || "")}"
          />
        </label>

        <label>
          نوع المادة
          <select name="material_type">
            ${[
              ["lesson", "درس"],
              ["tafsir", "تفسير"],
              ["fiqh", "فقه"],
              ["hadith", "حديث"],
              ["sirah", "سيرة"],
              ["noorani", "القاعدة النورانية"],
              ["quran", "قرآن"],
              ["document", "مستند"],
              ["link", "رابط"],
              ["note", "ملاحظة"],
              ["other", "أخرى"]
            ].map(([value, label]) => `
              <option
                value="${value}"
                ${
                  material?.material_type === value
                    ? "selected"
                    : ""
                }
              >${label}</option>
            `).join("")}
          </select>
        </label>

        <label>
          المحتوى
          <textarea
            name="content"
            rows="4"
            maxlength="10000"
          >${escapeHtml(material?.content || "")}</textarea>
        </label>

        <label>
          رابط خارجي — اختياري
          <input
            type="url"
            name="external_url"
            maxlength="2000"
            value="${escapeHtml(
              material?.external_url || ""
            )}"
            placeholder="https://..."
          />
        </label>

        <label>
          رقم المستند — اختياري
          <input
            type="number"
            name="document_id"
            min="1"
            step="1"
            value="${
              material?.document_id
                ? Number(material.document_id)
                : ""
            }"
          />
        </label>

        <label>
          رقم آية القرآن — اختياري
          <input
            type="number"
            name="quran_ayah_id"
            min="1"
            step="1"
            value="${
              material?.quran_ayah_id
                ? Number(material.quran_ayah_id)
                : ""
            }"
          />
        </label>

        <div class="aw-classroom-material-editor-actions">
          <button
            type="submit"
            class="primary-button"
            ${this.state.classroom.materialSaving ? "disabled" : ""}
          >
            ${
              this.state.classroom.materialSaving
                ? "جارٍ الحفظ..."
                : editing
                  ? "حفظ التعديل"
                  : "إضافة المادة"
            }
          </button>

          <button
            type="button"
            class="secondary-button"
            data-classroom-action="cancel-material"
          >
            إلغاء
          </button>
        </div>
      </form>
    `;
  }

  async saveClassroomMaterial(form) {
    if (!this.canManageClassroomMaterials()) {
      return;
    }

    const data = new FormData(form);

    const id =
      Number(data.get("id") || 0);

    const title =
      String(data.get("title") || "").trim();

    const materialType =
      String(
        data.get("material_type") || "lesson"
      );

    const content =
      String(data.get("content") || "").trim();

    const externalUrl =
      String(
        data.get("external_url") || ""
      ).trim();

    const documentId =
      Number(data.get("document_id") || 0);

    const quranAyahId =
      Number(
        data.get("quran_ayah_id") || 0
      );

    if (!title) {
      this.state.error = "عنوان المادة مطلوب";
      this.render();
      return;
    }

    this.state.classroom.materialSaving = true;
    this.render();

    try {
      const payload = {
        title,
        material_type: materialType,
        content: content || null,
        external_url: externalUrl || null,
        document_id:
          documentId > 0
            ? documentId
            : null,
        quran_ayah_id:
          quranAyahId > 0
            ? quranAyahId
            : null
      };

      if (id > 0) {
        await updateSessionMaterial(
          id,
          payload
        );
      } else {
        await createSessionMaterial(
          this.sessionId,
          payload
        );
      }

      this.state.classroom.materialEditorId = null;
      this.state.classroom.materialSaving = false;
      this.state.error = null;
      this.state.notice =
        id > 0
          ? "تم تحديث المادة العلمية"
          : "تمت إضافة المادة العلمية";

      await this.loadClassroomMaterials();
    } catch (error) {
      this.state.classroom.materialSaving = false;
      this.state.error =
        error?.message ||
        "MATERIAL_SAVE_FAILED";
      this.render();
    }
  }

  async archiveClassroomMaterial(materialId) {
    if (!this.canManageClassroomMaterials()) {
      return;
    }

    const id = Number(materialId);

    if (!Number.isInteger(id) || id < 1) {
      return;
    }

    try {
      await deleteSessionMaterial(id);

      this.state.notice =
        "تمت أرشفة المادة العلمية";

      await this.loadClassroomMaterials();
    } catch (error) {
      this.state.error =
        error?.message ||
        "MATERIAL_DELETE_FAILED";
      this.render();
    }
  }

  renderClassroomWorkflow() {
    const selectedId =
      Number(
        this.state.classroom.selectedStudentId
      ) || null;

    if (!selectedId) {
      return `
        <div class="aw-classroom-workflow-empty">
          اختر طالبًا من قائمة الفصل لبدء التسميع
          وإدارة الورد والمصحف والتقييم.
        </div>
      `;
    }

    const studentName =
      this.getStudentDisplayName(selectedId);

    const turn =
      this.getClassroomTurn(selectedId);

    const status =
      this.state.classroom.recitationStatus?.[selectedId] ||
      "waiting";

    return `
      <div class="aw-classroom-workflow">
        <div class="aw-classroom-workflow-head">
          <div>
            <strong>
              ${escapeHtml(studentName)}
            </strong>

            <span>
              الدور:
              ${turn?.turn_number ?? turn?.turn ?? "—"}
            </span>
          </div>

          <span class="aw-classroom-turn-status">
            ${
              status === "in_progress"
                ? "جاري التسميع"
                : status === "completed"
                  ? "تم التسميع"
                  : status === "skipped"
                    ? "تم التخطي"
                    : "في الانتظار"
            }
          </span>
        </div>

        <div class="aw-classroom-workflow-actions">
          <button
            type="button"
            class="primary-button"
            data-classroom-action="start-turn"
            data-classroom-student-id="${selectedId}"
          >
            بدء التسميع
          </button>

          <button
            type="button"
            class="secondary-button"
            data-classroom-action="finish-turn"
            data-classroom-student-id="${selectedId}"
          >
            إنهاء الدور
          </button>

          <button
            type="button"
            class="secondary-button"
            data-classroom-action="skip-turn"
            data-classroom-student-id="${selectedId}"
          >
            تخطي
          </button>
        </div>

        <div class="aw-classroom-tools">
          <button
            type="button"
            class="primary-button"
            data-classroom-action="open-quran"
            data-classroom-student-id="${selectedId}"
          >
            المصحف والورد
          </button>

          <button
            type="button"
            class="secondary-button"
            data-classroom-action="open-board"
          >
            السبورة
          </button>

          <button
            type="button"
            class="secondary-button"
            data-classroom-action="open-evaluation"
            data-classroom-student-id="${selectedId}"
          >
            التقييم
          </button>

          <button
            type="button"
            class="secondary-button"
            data-classroom-action="open-materials"
          >
            المواد العلمية
          </button>
        </div>
      </div>
    `;
  }

  getClassroomStudent(studentId) {
    const id = Number(studentId);

    return this.state.participants.find(
      (item) =>
        Number(item?.student_id || item?.studentId || item?.id) === id
    ) || (
      Array.isArray(this.state.registration?.registrations)
        ? this.state.registration.registrations.find(
            (item) =>
              Number(item?.student_id) === id
          )
        : null
    );
  }

  getClassroomAttendanceForStudent(studentId) {
    const id = Number(studentId);

    return (
      Array.isArray(this.state.classroom.attendance)
        ? this.state.classroom.attendance.find(
            (item) =>
              Number(item?.student_id || item?.studentId) === id
          )
        : null
    );
  }

  getStudentDisplayName(studentId) {
    const student =
      this.getClassroomStudent(studentId);

    return participantName(student);
  }

  async loadClassroomCore() {
    const sessionId = this.sessionId;

    if (!sessionId) {
      return;
    }

    this.state.classroom.loading = true;

    try {
      const [registration, attendance, wird] =
        await Promise.allSettled([
          getClassroomStudents(sessionId),
          getClassroomAttendance(sessionId),
          getClassroomWird(sessionId)
        ]);

      if (registration.status === "fulfilled") {
        this.state.registration =
          registration.value?.registration ||
          registration.value ||
          this.state.registration;
      }

      if (attendance.status === "fulfilled") {
        this.state.classroom.attendance =
          Array.isArray(attendance.value?.attendance)
            ? attendance.value.attendance
            : Array.isArray(attendance.value)
              ? attendance.value
              : [];
      }

      if (wird.status === "fulfilled") {
        this.state.classroom.wird =
          wird.value?.wird ||
          wird.value ||
          null;
      }
    } finally {
      this.state.classroom.loading = false;
      this.render();
    }
  }

  classroomSelectStudent(studentId) {
    const id = Number(studentId);

    if (!Number.isInteger(id) || id < 1) {
      return;
    }

    this.state.classroom.selectedStudentId = id;

    const student = this.getClassroomStudent(id);

    if (student) {
      this.state.quran.studentId =
        Number(
          student.student_id ||
          student.studentId ||
          student.id
        ) || null;
    }

    this.render();
  }

  async classroomSetAttendance(
    studentId,
    status
  ) {
    if (!studentId || !status) {
      return;
    }

    try {
      await saveClassroomAttendance(
        this.sessionId,
        studentId,
        status
      );

      await this.loadClassroomCore();
    } catch {
      this.state.error =
        "تعذر تحديث الحضور";
      this.render();
    }
  }

  async classroomEvaluate(studentId) {
    if (!studentId) {
      return;
    }

    const score = window.prompt(
      "درجة التسميع من 100:"
    );

    if (score === null) {
      return;
    }

    const numericScore = Number(score);

    if (
      !Number.isFinite(numericScore) ||
      numericScore < 0 ||
      numericScore > 100
    ) {
      this.state.error =
        "الدرجة يجب أن تكون من 0 إلى 100";
      this.render();
      return;
    }

    const note = window.prompt(
      "ملاحظة المعلم:"
    );

    try {
      await saveClassroomEvaluation(
        this.sessionId,
        studentId,
        {
          score: numericScore,
          note: note || ""
        }
      );

      this.state.classroom.evaluations = {
        ...this.state.classroom.evaluations,
        [studentId]: {
          score: numericScore,
          note: note || ""
        }
      };

      this.state.notice =
        "تم حفظ تقييم الطالب";
      this.render();
    } catch {
      this.state.error =
        "تعذر حفظ تقييم الطالب";
      this.render();
    }
  }

  renderClassroomStudents() {
    const registration =
      this.state.registration || {};

    const registrations =
      Array.isArray(registration.registrations)
        ? registration.registrations
        : [];

    const turns =
      Array.isArray(registration.turns)
        ? registration.turns
        : [];

    const students =
      registrations.length
        ? registrations.map((item) => {
            const turn =
              turns.find(
                (row) =>
                  Number(row.registration_id) ===
                  Number(item.id)
              );

            return {
              ...item,
              turn_number:
                turn?.turn_number ??
                turn?.turn ??
                null
            };
          })
        : this.state.participants;

    if (!students.length) {
      return `
        <div class="aw-classroom-empty">
          لا يوجد طلاب مسجلون في هذه الجلسة حتى الآن.
        </div>
      `;
    }

    return students.map((student, index) => {
      const studentId =
        Number(
          student.student_id ||
          student.studentId ||
          student.id
        );

      const attendance =
        this.getClassroomAttendanceForStudent(
          studentId
        );

      const selected =
        Number(
          this.state.classroom.selectedStudentId
        ) === studentId;

      const turn =
        student.turn_number ??
        student.turn ??
        index + 1;

      return `
        <article
          class="aw-classroom-student ${
            selected ? "is-selected" : ""
          }"
        >
          <button
            type="button"
            class="aw-classroom-student-main"
            data-classroom-action="select-student"
            data-classroom-student-id="${studentId}"
          >
            <strong>
              ${escapeHtml(
                participantName(student)
              )}
            </strong>

            <span>
              الدور: ${turn}
            </span>

            <span>
              الحضور:
              ${escapeHtml(
                String(
                  attendance?.status ||
                  "غير مسجل"
                )
              )}
            </span>
          </button>

          <div class="aw-classroom-student-actions">
            <button
              type="button"
              class="secondary-button"
              data-classroom-action="present"
              data-classroom-student-id="${studentId}"
            >حاضر</button>

            <button
              type="button"
              class="secondary-button"
              data-classroom-action="late"
              data-classroom-student-id="${studentId}"
            >متأخر</button>

            <button
              type="button"
              class="secondary-button"
              data-classroom-action="absent"
              data-classroom-student-id="${studentId}"
            >غائب</button>

            <button
              type="button"
              class="primary-button"
              data-classroom-action="evaluate"
              data-classroom-student-id="${studentId}"
            >تقييم</button>
          </div>
        </article>
      `;
    }).join("");
  }

  renderClassroomHub() {
    const wird = this.state.classroom.wird;

    return `
      <section class="aw-classroom-hub">
        <header class="aw-classroom-hub-header">
          <div>
            <h2>إدارة الفصل</h2>
            <p>
              الطلاب ← الدور ← الورد ← الحضور ← التسميع ← التقييم
            </p>
          </div>

          <button
            type="button"
            class="secondary-button"
            data-classroom-action="refresh"
          >تحديث</button>
        </header>

        <div class="aw-classroom-summary">
          <div>
            <strong>${this.state.participants.length}</strong>
            <span>مشارك</span>
          </div>

          <div>
            <strong>${this.getActiveSpeakerCount()}</strong>
            <span>متحدث</span>
          </div>

          <div>
            <strong>${
              Array.isArray(
                this.state.registration?.registrations
              )
                ? this.state.registration.registrations.length
                : 0
            }</strong>
            <span>مسجل</span>
          </div>

          <div>
            <strong>${
              wird
                ? "✓"
                : "—"
            }</strong>
            <span>الورد</span>
          </div>
        </div>

        <div class="aw-classroom-hub-grid">
          <section class="aw-classroom-students-panel">
            <h3>طلاب الفصل والدور</h3>
            <div class="aw-classroom-students">
              ${this.renderClassroomStudents()}
            </div>
          </section>

          <section class="aw-classroom-work-panel">
            <h3>عمل الطالب المحدد</h3>

            ${this.renderClassroomWorkflow()}

            ${
              this.state.classroom.selectedStudentId
                ? `
                  <div class="aw-classroom-selected">
                    <strong>
                      ${escapeHtml(
                        this.getStudentDisplayName(
                          this.state.classroom.selectedStudentId
                        )
                      )}
                    </strong>

                    <div class="aw-classroom-work-actions">
                      <button
                        type="button"
                        class="primary-button"
                        data-classroom-action="open-quran"
                      >المصحف والورد</button>

                      <button
                        type="button"
                        class="secondary-button"
                        data-classroom-action="open-board"
                      >السبورة</button>

                      <button
                        type="button"
                        class="secondary-button"
                        data-classroom-action="evaluate"
                        data-classroom-student-id="${
                          this.state.classroom.selectedStudentId
                        }"
                      >التقييم</button>
                    </div>
                  </div>
                `
                : `
                  <div class="aw-classroom-empty">
                    اختر طالبًا لعرض أدواته داخل الفصل.
                  </div>
                `
            }
          </section>
        </div>
      </section>
    `;
  }

  async loadQuranResources() {
    const quran = this.state.quran;

    if (!quran.ayahId) {
      quran.resources = [];
      return;
    }

    quran.resourceLoading = true;

    try {
      const data = await getQuranResources(
        quran.ayahId,
        quran.resourceType,
        this.sessionId
      );

      quran.resources =
        Array.isArray(data?.resources)
          ? data.resources
          : [];
    } catch {
      quran.resources = [];
    } finally {
      quran.resourceLoading = false;
      this.render();
    }
  }

  async quranSaveResource() {
    const quran = this.state.quran;

    if (!quran.ayahId) {
      return;
    }

    const title = window.prompt(
      "عنوان المحتوى العلمي:"
    );

    if (title === null) {
      return;
    }

    const content = window.prompt(
      "اكتب المحتوى:"
    );

    if (content === null) {
      return;
    }

    try {
      await saveQuranResource(
        quran.ayahId,
        quran.resourceType,
        title,
        content,
        {
          source: "teacher"
        },
        this.sessionId
      );

      await this.loadQuranResources();
    } catch {
      this.state.error =
        "تعذر حفظ المحتوى العلمي";
      this.render();
    }
  }

  async quranDeleteResource(id) {
    if (!id) {
      return;
    }

    try {
      await deleteQuranResource(
        id,
        this.sessionId
      );
      await this.loadQuranResources();
    } catch {
      this.state.error =
        "تعذر حذف المحتوى العلمي";
      this.render();
    }
  }

  async loadQuranAnnotations() {
    const quran = this.state.quran;

    if (!quran.studentId) {
      quran.annotations = [];
      return;
    }

    quran.loading = true;

    try {
      const data = await getQuranAnnotations(
        quran.studentId,
        quran.ayahId,
        this.sessionId
      );

      quran.annotations =
        Array.isArray(data?.annotations)
          ? data.annotations
          : [];
    } catch {
      quran.annotations = [];
    } finally {
      quran.loading = false;
      this.render();
    }
  }

  async quranSaveAnnotation(type) {
    const quran = this.state.quran;

    if (!quran.studentId || !quran.ayahId) {
      return;
    }

    let value = "";

    if (type === "note" || type === "teacher_note") {
      value = window.prompt("اكتب الملاحظة:");
      if (!value) return;
    }

    const data = {
      text: value,
      source: type === "teacher_note"
        ? "teacher"
        : "student"
    };

    try {
      await saveQuranAnnotation(
        quran.studentId,
        quran.ayahId,
        type,
        data,
        this.sessionId
      );

      await this.loadQuranAnnotations();
    } catch {
      this.state.error = "تعذر حفظ تعديل المصحف";
      this.render();
    }
  }

  async quranDeleteAnnotation(id) {
    if (!id) return;

    try {
      await deleteQuranAnnotation(
        id,
        this.sessionId
      );
      await this.loadQuranAnnotations();
    } catch {
      this.state.error = "تعذر حذف التعديل";
      this.render();
    }
  }

  quranSetMode(mode) {
    this.state.quran.mode =
      mode === "teacher"
        ? "teacher"
        : "student";

    this.render();
  }

  quranSelectAyah(ayahId, text = "", surahName = "") {
    this.state.quran.ayahId = Number(ayahId) || null;
    this.state.quran.ayahText = String(text || "");
    this.state.quran.surahName = String(
      surahName || ""
    );

    this.loadQuranAnnotations();
    this.loadQuranResources();
  }

  renderMaterialsPanel() {
    return this.renderClassroomMaterials();
  }

  renderQuran() {
    const quran = this.state.quran;

    const annotations =
      Array.isArray(quran.annotations)
        ? quran.annotations
        : [];

    const annotationItems = annotations.map((item) => {
      const data =
        item.annotation_data &&
        typeof item.annotation_data === "object"
          ? item.annotation_data
          : {};

      return `
        <article class="aw-quran-annotation">
          <div>
            <strong>
              ${escapeHtml(
                String(item.annotation_type || "")
              )}
            </strong>

            ${
              data.text
                ? `<p>${escapeHtml(String(data.text))}</p>`
                : ""
            }
          </div>

          <button
            type="button"
            class="secondary-button"
            data-quran-action="delete"
            data-quran-id="${Number(item.id)}"
          >حذف</button>
        </article>
      `;
    }).join("");

    const teacherResources = [
      ["tafsir", "التفسير"],
      ["hadith", "الحديث"],
      ["mutashabihat", "المتشابهات"],
      ["asbab_al_nuzul", "أسباب النزول"],
      ["tajweed", "التجويد"],
      ["tahajji", "التهجي"],
      ["noor_al_bayan", "نور البيان"],
      ["gharib", "غريب القرآن"]
    ];

    return `
      <section class="aw-quran">
        <header class="aw-quran-header">
          <div>
            <strong>
              ${
                quran.mode === "teacher"
                  ? "مصحف المعلم العلمي"
                  : "مصحف الطالب الشخصي"
              }
            </strong>

            <small>
              ${
                quran.mode === "teacher"
                  ? "مصادر علمية مرتبطة بالآية"
                  : "مصحفك الخاص وتعديلاتك وملاحظاتك"
              }
            </small>
          </div>

          <div class="aw-quran-modes">
            <button
              type="button"
              class="${
                quran.mode === "student"
                  ? "primary-button"
                  : "secondary-button"
              }"
              data-quran-action="student-mode"
            >مصحف الطالب</button>

            <button
              type="button"
              class="${
                quran.mode === "teacher"
                  ? "primary-button"
                  : "secondary-button"
              }"
              data-quran-action="teacher-mode"
            >مصحف المعلم</button>
          </div>
        </header>

        <div class="aw-quran-location">
          ${
            quran.surahName
              ? `<strong>${escapeHtml(quran.surahName)}</strong>`
              : "لم يتم اختيار سورة"
          }

          ${
            quran.ayahId
              ? `<span>آية ${Number(quran.ayahId)}</span>`
              : ""
          }
        </div>

        <div class="aw-quran-ayah">
          ${
            quran.ayahText
              ? escapeHtml(quran.ayahText)
              : "اختر آية من المصحف لعرضها هنا"
          }
        </div>

        ${
          quran.mode === "student"
            ? `
              <div class="aw-quran-tools">
                <button
                  type="button"
                  class="secondary-button"
                  data-quran-action="note"
                >📝 ملاحظة</button>

                <button
                  type="button"
                  class="secondary-button"
                  data-quran-action="highlight"
                >🟨 تمييز</button>

                <button
                  type="button"
                  class="secondary-button"
                  data-quran-action="memorization"
                >📖 حفظ</button>

                <button
                  type="button"
                  class="secondary-button"
                  data-quran-action="review"
                >🔄 مراجعة</button>

                <button
                  type="button"
                  class="secondary-button"
                  data-quran-action="tamkeen"
                >✓ تمكين</button>

                <button
                  type="button"
                  class="secondary-button"
                  data-quran-action="error"
                >⚠ خطأ</button>

                <button
                  type="button"
                  class="secondary-button"
                  data-quran-action="favorite"
                >⭐ مفضلة</button>
              </div>
            `
            : `
              <div class="aw-quran-resources">
                ${teacherResources.map(([type, label]) => `
                  <button
                    type="button"
                    class="${
                      quran.resourceType === type
                        ? "primary-button"
                        : "secondary-button"
                    }"
                    data-quran-action="resource"
                    data-quran-resource="${type}"
                  >${label}</button>
                `).join("")}
              </div>

              <div class="aw-quran-teacher-note">
                <button
                  type="button"
                  class="primary-button"
                  data-quran-action="add-resource"
                >+ إضافة محتوى علمي</button>

                <button
                  type="button"
                  class="secondary-button"
                  data-quran-action="teacher-note"
                >+ ملاحظة للمعلم</button>
              </div>

              <div class="aw-quran-resource-list">
                ${
                  quran.resourceLoading
                    ? `<div class="aw-quran-empty">
                        جارٍ تحميل المحتوى...
                       </div>`
                    : (
                      Array.isArray(quran.resources) &&
                      quran.resources.length
                        ? quran.resources.map((item) => `
                            <article class="aw-quran-resource">
                              <div>
                                ${
                                  item.title
                                    ? `<strong>${escapeHtml(
                                        String(item.title)
                                      )}</strong>`
                                    : ""
                                }

                                <p>${escapeHtml(
                                  String(item.content || "")
                                )}</p>
                              </div>

                              <button
                                type="button"
                                class="secondary-button"
                                data-quran-action="delete-resource"
                                data-quran-resource-id="${Number(
                                  item.id
                                )}"
                              >حذف</button>
                            </article>
                          `).join("")
                        : `<div class="aw-quran-empty">
                            لا يوجد محتوى علمي مضاف لهذه الآية بعد.
                           </div>`
                    )
                }
              </div>
            `
        }

        <div class="aw-quran-annotations">
          <h4>
            ${
              quran.mode === "teacher"
                ? "ملاحظات ومحتوى الآية"
                : "تعديلات الطالب على الآية"
            }
          </h4>

          ${
            annotationItems ||
            `<div class="aw-quran-empty">
              لا توجد تعديلات على هذه الآية بعد.
            </div>`
          }
        </div>
      </section>
    `;
  }

  render() {
    if (!this.options.root) {
      return;
    }

    const controls = this.renderControls();

    this.options.root.innerHTML = `
      <section class="alawabin-classroom" dir="rtl">
        ${controls}

        <header class="classroom-header">
          <div>
            <h1>${escapeHtml(this.getSessionTitle())}</h1>
            <p>${escapeHtml(this.getSessionTime())}</p>
          </div>

          <div class="classroom-timer"
               data-classroom-timer>
            ${formatDuration(this.state.elapsedSeconds)}
          </div>
        </header>

        ${this.renderSessionStatus()}

        ${this.renderRegistrationQueue()}

        ${this.renderClassroomHub()}

        <main class="classroom-main">
          <div class="classroom-stage">
            ${this.renderBoard()}

          ${this.renderQuran()}

          ${
            this.state.classroom.panel === "materials"
              ? this.renderMaterialsPanel()
              : ""
          }

          <div
            id="livekit-media-stage"
            class="classroom-stage-placeholder"
            aria-label="الصوت والصورة في الفصل الحي"
          >
            <strong>الفصل الحي</strong>
            <span>
              ${this.liveKitConnected
                ? "الاتصال الصوتي والمرئي متصل"
                : "الاتصال الصوتي والمرئي غير متصل"}
            </span>
          </div>
          </div>

          <aside class="classroom-sidebar">
            <div class="classroom-status">
              <strong>المشاركون</strong>
              <span>
                ${this.state.participants.length}
              </span>
            </div>

            <div class="classroom-status">
              <strong>المتحدثون</strong>
              <span>
                ${this.getActiveSpeakerCount()}
              </span>
            </div>

            <div class="classroom-participants">
              ${this.renderParticipants()}
            </div>
          </aside>
        </main>

        ${this.renderError()}
      </section>
    `;
  }

  renderSessionStatus() {
    const roomStatus =
      this.getRoomStatusLabel();

    const participantCount =
      this.getParticipantCount();

    const connectedCount =
      this.getConnectedParticipantCount();

    const speakerCount =
      this.getActiveSpeakerCount();

    const windowStatus =
      this.getRegistrationWindowLabel();

    const registration =
      this.getMyRegistration();

    const turn =
      this.getMyTurn();

    const registrationStatus =
      registration?.status || null;

    const turnStatus =
      turn?.status || null;

    const turnNumber =
      turn?.turn_number ??
      turn?.turn ??
      null;

    const studentStatus =
      registration
        ? (
            turnNumber
              ? `مسجل — الدور ${turnNumber}`
              : "مسجل في التسميع"
          )
        : "غير مسجل";

    const turnLabel = {
      waiting: "في الانتظار",
      called: "تم النداء",
      reciting: "يقرأ الآن",
      completed: "اكتمل",
      skipped: "تم التخطي",
      absent: "غائب"
    };

    const currentTurn =
      turnStatus
        ? (
            turnLabel[turnStatus] ||
            turnStatus
          )
        : "لا يوجد دور";

    return `
      <div class="live-session-status" dir="rtl">

        <div class="live-status-item">
          <span>حالة الفصل</span>
          <strong>${escapeHtml(roomStatus)}</strong>
        </div>

        <div class="live-status-item">
          <span>المشاركون</span>
          <strong>
            ${participantCount}
            ${connectedCount !== participantCount
              ? ` / ${connectedCount} متصل`
              : ""}
          </strong>
        </div>

        <div class="live-status-item">
          <span>المتحدثون</span>
          <strong>
            ${speakerCount}
          </strong>
        </div>

        <div class="live-status-item">
          <span>نافذة التسجيل</span>
          <strong>${escapeHtml(windowStatus)}</strong>
        </div>

        ${
          this.options.user?.student_id
            ? `
              <div class="live-status-item live-my-status">
                <span>حالتي في التسميع</span>
                <strong>
                  ${escapeHtml(studentStatus)}
                </strong>
                ${
                  registrationStatus
                    ? `
                      <small>
                        حالة التسجيل:
                        ${escapeHtml(
                          registrationStatus
                        )}
                      </small>
                    `
                    : ""
                }
              </div>

              <div class="live-status-item live-my-turn">
                <span>الدور</span>
                <strong>
                  ${escapeHtml(currentTurn)}
                </strong>
              </div>
            `
            : ""
        }

      </div>
    `;
  }

  renderControls() {
    const user = this.options.user || {};
    const studentId = Number(user?.student_id || 0);
    const canModerate = this.canModerate();
    const canRecord = this.canRecord();

    const joinedButton = this.state.joined
      ? `<button type="button" disabled>تم الدخول</button>`
      : `<button type="button" data-live-action="join">دخول الفصل</button>`;

    const windowStatus =
      this.getRegistrationWindowStatus();

    const myRegistration =
      this.getMyRegistration();

    const canRegister =
      studentId > 0 &&
      windowStatus === "open" &&
      !myRegistration;

    const canCancelRegistration =
      studentId > 0 &&
      Boolean(myRegistration) &&
      windowStatus === "open";

    const registration =
      studentId > 0
        ? `
          <div class="live-control-group">
            <strong>التسجيل في التسميع</strong>

            ${
              canRegister
                ? `
                  <button
                    type="button"
                    data-live-action="register">
                    تسجيل الاسم
                  </button>
                `
                : ""
            }

            ${
              canCancelRegistration
                ? `
                  <button
                    type="button"
                    data-live-action="cancel-registration">
                    إلغاء التسجيل
                  </button>
                `
                : ""
            }

            ${
              myRegistration
                ? `
                  <span class="live-registration-state">
                    تم تسجيل اسمك في قائمة التسميع
                  </span>
                `
                : windowStatus !== "open"
                  ? `
                    <span class="live-registration-state">
                      ${escapeHtml(
                        this.getRegistrationWindowLabel()
                      )}
                    </span>
                  `
                  : ""
            }
          </div>
        `
        : "";

    const moderation =
      canModerate
        ? `
          <div class="live-control-group">
            <strong>إدارة الفصل</strong>
            <button type="button" data-live-action="create-room">
              تجهيز الفصل
            </button>
            <button type="button" data-live-action="refresh-registration">
              تحديث قائمة التسميع
            </button>
          </div>
        `
        : "";

    // التسجيل الصوتي غير مستخدم في أكاديمية الأوَّابين.
    // لا يتم عرض أي أدوات لتسجيل أصوات الطلاب.
    const liveKitControls =
      this.liveKitConnected && this.liveKitCanPublish
        ? `
        <div class="live-control-group">
          <button
            type="button"
            class="secondary-button"
            data-live-control="livekit-mic-on"
          >
            تشغيل الميكروفون
          </button>

          <button
            type="button"
            class="secondary-button"
            data-live-control="livekit-mic-off"
          >
            إيقاف الميكروفون
          </button>

          <button
            type="button"
            class="secondary-button"
            data-live-control="livekit-camera-on"
          >
            تشغيل الكاميرا
          </button>

          <button
            type="button"
            class="secondary-button"
            data-live-control="livekit-camera-off"
          >
            إيقاف الكاميرا
          </button>
        </div>
      `
        : "";

    const recording = "";

    return `
      <section class="live-controls" aria-label="تحكم الفصل الحي">
        <div class="live-control-group">
          ${joinedButton}
        </div>
        ${registration}
        ${moderation}
        ${this.renderHostManagement()}
        ${recording}
      </section>
    `;
  }

  async handleTurnAction(action, registrationId) {
    const id = Number(registrationId || 0);

    if (!id) {
      throw new Error("INVALID_REGISTRATION_ID");
    }

    if (!this.canModerate()) {
      throw new Error("LIVE_ROOM_MODERATION_FORBIDDEN");
    }

    const actions = {
      call: "call_turn",
      start: "start_turn",
      complete: "complete_turn",
      skip: "skip_turn",
      absent: "absent_turn"
    };

    const apiAction = actions[action];

    if (!apiAction) {
      throw new Error("UNKNOWN_TURN_ACTION");
    }

    this.setState({
      loading: true,
      error: null,
      notice: null
    });

    try {
      const data = await this.manageTurn(apiAction, id);

      await this.refreshRegistration();

      this.state.notice = "تم تحديث دور الطالب";

      return data;
    } catch (error) {
      this.state.error =
        error?.message || "تعذر تحديث دور الطالب";
      throw error;
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  async handleParticipantAction(
    action,
    participantId
  ) {
    const id = normalizeId(participantId);

    if (!String(action || "").trim()) {
      throw new Error(
        "LIVE_PARTICIPANT_ACTION_REQUIRED"
      );
    }

    switch (action) {
      case "grant-speaker":
        return this.grantSpeaker(id);

      case "revoke-speaker":
        return this.revokeSpeaker(id);

      case "mute":
        return this.muteParticipant(id);

      case "unmute":
        return this.unmuteParticipant(id);

      case "disable-camera":
        return this.disableParticipantCamera(id);

      case "enable-camera":
        return this.enableParticipantCamera(id);

      case "reconnect":
        return this.reconnectParticipant(id);

      case "remove":
        return this.removeParticipant(id);

      default:
        throw new Error(
          "UNKNOWN_LIVE_PARTICIPANT_ACTION"
        );
    }
  }

  async handleControl(action) {
    if (action === "livekit-mic-on") {
      await this.setLiveKitMicrophone(true);
      return;
    }

    if (action === "livekit-mic-off") {
      await this.setLiveKitMicrophone(false);
      return;
    }

    if (action === "livekit-camera-on") {
      await this.setLiveKitCamera(true);
      return;
    }

    if (action === "livekit-camera-off") {
      await this.setLiveKitCamera(false);
      return;
    }


    switch (action) {
      case "join":
        return this.joinSession();

      case "register":
        return this.register();

      case "cancel-registration":
        return this.cancelRegistration();

      case "create-room":
        return this.createOrOpenRoom();

      case "refresh-registration":
        return this.refreshRegistration();

      default:
        throw new Error("UNKNOWN_LIVE_CONTROL");
    }
  }

  bindControls() {
    if (!this.root) {
      return;
    }

    if (this._controlsBound) {
      return;
    }

    this._controlsBound = true;

    this._controlHandler = async (event) => {
      const controlButton =
        event.target.closest("[data-live-action]");


      const boardButton =
        event.target.closest("[data-board-action]");

      if (boardButton) {
        const action =
          boardButton.getAttribute("data-board-action");

        if (action === "tool") {
          this.boardSetTool(
            boardButton.getAttribute("data-board-tool")
          );
          return;
        }

        if (action === "text") {
          await this.boardAddText();
          return;
        }

        if (action === "shape") {
          this.boardAddShape(
            boardButton.getAttribute("data-board-shape")
          );
          return;
        }

        if (action === "undo") {
          this.boardUndo();
          return;
        }

        if (action === "redo") {
          this.boardRedo();
          return;
        }

        if (action === "clear") {
          await this.boardClear();
          return;
        }

        if (action === "lock") {
          await this.boardLock();
          return;
        }

        if (action === "unlock") {
          await this.boardUnlock();
          return;
        }

        if (action === "add-page") {
          this.boardAddPage();
          return;
        }

        if (action === "page") {
          this.boardSelectPage(
            boardButton.getAttribute("data-board-page")
          );
          return;
        }
      }


      const quranButton =
        event.target.closest("[data-quran-action]");

      if (quranButton) {
        const action =
          quranButton.getAttribute("data-quran-action");

        if (action === "student-mode") {
          this.quranSetMode("student");
          return;
        }

        if (action === "teacher-mode") {
          this.quranSetMode("teacher");
          return;
        }

        if (action === "resource") {
          this.state.quran.resourceType =
            quranButton.getAttribute(
              "data-quran-resource"
            ) || "tafsir";

          await this.loadQuranResources();
          return;
        }

        if (action === "add-resource") {
          await this.quranSaveResource();
          return;
        }

        if (action === "delete-resource") {
          await this.quranDeleteResource(
            Number(
              quranButton.getAttribute(
                "data-quran-resource-id"
              )
            )
          );
          return;
        }

        if (action === "teacher-note") {
          await this.quranSaveAnnotation(
            "teacher_note"
          );
          return;
        }

        if (action === "delete") {
          await this.quranDeleteAnnotation(
            Number(
              quranButton.getAttribute("data-quran-id")
            )
          );
          return;
        }

        if (
          [
            "note",
            "highlight",
            "memorization",
            "review",
            "tamkeen",
            "error",
            "favorite"
          ].includes(action)
        ) {
          await this.quranSaveAnnotation(action);
          return;
        }
      }


      const materialForm =
        event.target.closest(
          "[data-classroom-material-form]"
        );

      if (
        materialForm &&
        event.type === "submit"
      ) {
        event.preventDefault();
        await this.saveClassroomMaterial(
          materialForm
        );
        return;
      }

      const classroomButton =
        event.target.closest(
          "[data-classroom-action]"
        );

      if (classroomButton) {
        const action =
          classroomButton.getAttribute(
            "data-classroom-action"
          );

        const studentId =
          Number(
            classroomButton.getAttribute(
              "data-classroom-student-id"
            )
          );

        if (action === "select-student") {
          this.classroomSelectStudent(studentId);
          return;
        }

        if (
          ["present", "late", "absent"].includes(action)
        ) {
          await this.classroomSetAttendance(
            studentId,
            action
          );
          return;
        }

        if (action === "evaluate") {
          await this.classroomEvaluate(studentId);
          return;
        }

        if (action === "refresh") {
          await this.loadClassroomCore();
          return;
        }

        if (action === "open-quran") {
          if (studentId) {
            this.classroomSelectStudent(studentId);
          }

          this.state.quran.mode = "student";
          this.render();
          return;
        }

        if (action === "open-board") {
          this.state.notice =
            "السبورة مفتوحة داخل الفصل";
          this.render();
          return;
        }

        if (action === "open-materials") {
          await this.classroomOpenMaterials();
          return;
        }

        if (action === "refresh-materials") {
          await this.loadClassroomMaterials();
          return;
        }

        if (action === "add-material") {
          if (this.canManageClassroomMaterials()) {
            this.state.classroom.materialEditorId = 0;
            this.render();
          }
          return;
        }

        if (action === "edit-material") {
          if (this.canManageClassroomMaterials()) {
            this.state.classroom.materialEditorId =
              Number(
                classroomButton.getAttribute(
                  "data-material-id"
                )
              ) || 0;
            this.render();
          }
          return;
        }

        if (action === "cancel-material") {
          this.state.classroom.materialEditorId = null;
          this.render();
          return;
        }

        if (action === "delete-material") {
          await this.archiveClassroomMaterial(
            classroomButton.getAttribute(
              "data-material-id"
            )
          );
          return;
        }

        if (action === "start-turn") {
          await this.classroomStartTurn(studentId);
          return;
        }

        if (action === "finish-turn") {
          await this.classroomFinishTurn(
            studentId,
            "completed"
          );
          return;
        }

        if (action === "skip-turn") {
          await this.classroomFinishTurn(
            studentId,
            "skipped"
          );
          return;
        }
      }

      const hostButton =
        event.target.closest(
          "[data-live-host-action]"
        );

      if (hostButton) {
        const action =
          hostButton.getAttribute(
            "data-live-host-action"
          );

        const userId =
          Number(
            hostButton.getAttribute(
              "data-host-user-id"
            )
          );

        if (!userId) {
          throw new Error("TARGET_USER_REQUIRED");
        }

        if (action === "revoke-host") {
          await this.revokeHost(userId);
          return;
        }

        if (action === "revoke-cohost") {
          await this.revokeCohost(userId);
          return;
        }

        if (action === "assign-host") {
          const select =
            this.options.root.querySelector(
              "[data-live-host-select]"
            );

          const targetUserId =
            Number(select?.value || 0);

          if (!targetUserId) {
            throw new Error("TARGET_USER_REQUIRED");
          }

          await this.assignHost(targetUserId);
          return;
        }

        if (action === "assign-cohost") {
          const select =
            this.options.root.querySelector(
              "[data-live-cohost-select]"
            );

          const targetUserId =
            Number(select?.value || 0);

          if (!targetUserId) {
            throw new Error("TARGET_USER_REQUIRED");
          }

          const permissions = [
            ...this.options.root.querySelectorAll(
              "[data-live-cohost-permissions] input[data-live-host-permission]:checked"
            )
          ].map(
            (input) => input.value
          );

          await this.assignCohost(
            targetUserId,
            permissions
          );

          return;
        }

        if (action === "edit-cohost") {
          this.state.hosts.editorUserId = userId;
          this.render();
          return;
        }

        if (action === "cancel-edit-cohost") {
          this.state.hosts.editorUserId = null;
          this.render();
          return;
        }

        if (action === "save-cohost") {
          const editor =
            hostButton.closest(".live-host-editor");

          const permissions = [
            ...(editor
              ? editor.querySelectorAll(
                  "[data-live-host-permission]:checked"
                )
              : [])
          ].map(
            (input) => input.value
          );

          await this.updateCohost(
            userId,
            permissions
          );

          this.state.hosts.editorUserId = null;
          this.render();
          return;
        }
      }

      const participantButton =
        event.target.closest(
          "[data-live-participant-action]"
        );

      const turnButton =
        event.target.closest(
          "[data-live-turn-action]"
        );

      const button =
        controlButton ||
        participantButton ||
        turnButton;

      if (!button || !this.root.contains(button)) {
        return;
      }

      if (this.state.loading) {
        return;
      }

      try {
        if (participantButton) {
          const action =
            participantButton.getAttribute(
              "data-live-participant-action"
            );

          const participantId =
            participantButton.getAttribute(
              "data-participant-id"
            );

          await this.handleParticipantAction(
            action,
            participantId
          );

          return;
        }

        const turnAction =
          button.getAttribute(
            "data-live-turn-action"
          );

        if (turnAction) {
          const registrationId =
            button.getAttribute(
              "data-registration-id"
            );

          await this.handleTurnAction(
            turnAction,
            registrationId
          );

          return;
        }

        const action =
          controlButton.getAttribute(
            "data-live-action"
          );

        if (!action) {
          return;
        }

        await this.handleControl(action);
      } catch (error) {
        this.state.error =
          error?.message ||
          "تعذر تنفيذ الأمر";
        this.render();
      }
    };

    this.root.addEventListener(
      "click",
      this._controlHandler
    );
  }

  unbindControls() {
    if (
      this.root &&
      this._controlHandler
    ) {
      this.root.removeEventListener(
        "click",
        this._controlHandler
      );
    }

    this._controlHandler = null;
    this._controlsBound = false;
  }

  renderParticipantActions(participant) {
    if (!this.canModerate()) {
      return "";
    }

    const id = Number(participant?.id || 0);

    if (!Number.isInteger(id) || id < 1) {
      return "";
    }

    const role =
      String(participant?.media_role || "listener");

    const connection =
      String(
        participant?.connection_status ||
        "disconnected"
      );

    const participantStudentId =
      Number(
        participant?.student_id ||
        participant?.studentId ||
        0
      );

    const myTurn =
      this.getMyTurn();

    const myTurnStudentId =
      Number(
        myTurn?.student_id ||
        myTurn?.studentId ||
        0
      );

    const isMyActiveTurn =
      participantStudentId > 0 &&
      myTurnStudentId > 0 &&
      participantStudentId === myTurnStudentId &&
      String(myTurn?.status || "") === "reciting";

    const isSpeaker =
      role === "speaker" ||
      isMyActiveTurn;

    const connected =
      connection === "connected" ||
      connection === "reconnecting";

    const speakerAction = isSpeaker
      ? `
        <button
          type="button"
          data-live-participant-action="revoke-speaker"
          data-participant-id="${id}">
          إعادة كمستمع
        </button>
      `
      : `
        <button
          type="button"
          data-live-participant-action="grant-speaker"
          data-participant-id="${id}"
          ${connected ? "" : "disabled"}>
          رفع للمتحدث
        </button>
      `;

    const micAction =
      participant?.mic_enabled
        ? `
          <button
            type="button"
            data-live-participant-action="mute"
            data-participant-id="${id}">
            كتم الميكروفون
          </button>
        `
        : `
          <button
            type="button"
            data-live-participant-action="unmute"
            data-participant-id="${id}"
            ${isSpeaker ? "" : "disabled"}>
            فتح الميكروفون
          </button>
        `;

    const cameraAction =
      participant?.camera_enabled
        ? `
          <button
            type="button"
            data-live-participant-action="disable-camera"
            data-participant-id="${id}">
            إيقاف الكاميرا
          </button>
        `
        : `
          <button
            type="button"
            data-live-participant-action="enable-camera"
            data-participant-id="${id}"
            ${isSpeaker ? "" : "disabled"}>
            تشغيل الكاميرا
          </button>
        `;

    return `
      <div class="live-participant-actions">
        ${speakerAction}
        ${micAction}
        ${cameraAction}

        <button
          type="button"
          data-live-participant-action="reconnect"
          data-participant-id="${id}">
          إعادة الاتصال
        </button>

        <button
          type="button"
          data-live-participant-action="remove"
          data-participant-id="${id}">
          إخراج من الفصل
        </button>
      </div>
    `;
  }

  renderRegistrationQueue() {
    const registration =
      this.state.registration || {};

    const registrations =
      Array.isArray(registration?.registrations)
        ? registration.registrations
        : [];

    const turns =
      Array.isArray(registration?.turns)
        ? registration.turns
        : [];

    if (!registrations.length) {
      return `
        <section class="live-registration-queue">
          <header>
            <strong>قائمة التسميع</strong>
          </header>
          <p>لا يوجد طلاب مسجلون حاليًا.</p>
        </section>
      `;
    }

    const turnByRegistration = new Map(
      turns.map((turn) => [
        Number(turn?.registration_id),
        turn
      ])
    );

    const turnLabels = {
      waiting: "في الانتظار",
      called: "تم النداء",
      reciting: "يقرأ الآن",
      completed: "اكتمل",
      skipped: "تم التخطي",
      absent: "غائب"
    };

    const currentUser =
      this.options.user || {};

    const currentStudentId =
      Number(
        currentUser?.student_id ||
        currentUser?.studentId ||
        0
      );

    const rows = registrations
      .map((registrationItem, index) => {
        const registrationId =
          Number(registrationItem?.id || 0);

        const turn =
          turnByRegistration.get(
            registrationId
          ) || null;

        const turnNumber =
          turn?.turn_number ??
          turn?.turn ??
          index + 1;

        const status =
          String(
            turn?.status ||
            registrationItem?.status ||
            "waiting"
          );

        const name =
          registrationItem?.student_name ||
          registrationItem?.full_name ||
          registrationItem?.name ||
          `طالب ${turnNumber}`;

        const registrationStudentId =
          Number(
            registrationItem?.student_id ||
            registrationItem?.studentId ||
            0
          );

        const isMyRegistration =
          currentStudentId > 0 &&
          registrationStudentId > 0 &&
          currentStudentId === registrationStudentId;

        return `
          <article
            class="live-registration-row${
              isMyRegistration
                ? " live-registration-row-current"
                : ""
            }">

            ${
              isMyRegistration
                ? `
                  <div class="live-my-registration">
                    دوري
                  </div>
                `
                : ""
            }
            <div class="live-registration-main">
              <strong>
                ${escapeHtml(String(turnNumber))}
                —
                ${escapeHtml(String(name))}
              </strong>

              <small>
                ${escapeHtml(
                  turnLabels[status] || status
                )}
              </small>
            </div>

            ${
              this.canModerate() &&
              registrationId > 0
                ? `
                  <div
                    class="live-registration-actions"
                    data-registration-id="${registrationId}">
                    ${
                      status === "waiting"
                        ? `
                          <button
                            type="button"
                            data-live-turn-action="call"
                            data-registration-id="${registrationId}">
                            نداء
                          </button>
                        `
                        : ""
                    }

                    ${
                      status === "called"
                        ? `
                          <button
                            type="button"
                            data-live-turn-action="start"
                            data-registration-id="${registrationId}">
                            بدء التسميع
                          </button>
                        `
                        : ""
                    }

                    ${
                      status === "reciting"
                        ? `
                          <button
                            type="button"
                            data-live-turn-action="complete"
                            data-registration-id="${registrationId}">
                            إنهاء
                          </button>

                          <button
                            type="button"
                            data-live-turn-action="skip"
                            data-registration-id="${registrationId}">
                            تخطي
                          </button>
                        `
                        : ""
                    }

                    ${
                      status === "waiting" ||
                      status === "called"
                        ? `
                          <button
                            type="button"
                            data-live-turn-action="absent"
                            data-registration-id="${registrationId}">
                            غائب
                          </button>
                        `
                        : ""
                    }
                  </div>
                `
                : ""
            }
          </article>
        `;
      })
      .join("");

    return `
      <section
        class="live-registration-queue"
        dir="rtl">

        <header>
          <strong>قائمة التسميع</strong>
          <span>
            ${registrations.length} مسجل
          </span>
        </header>

        <div class="live-registration-list">
          ${rows}
        </div>

      </section>
    `;
  }

  renderParticipants() {
    if (!this.state.participants.length) {
      return `
        <div class="classroom-empty">
          لا يوجد مشاركون حاليًا.
        </div>
      `;
    }

    return this.state.participants
      .map((participant) => `
        <div class="classroom-participant">
          <div>
            <strong>
              ${escapeHtml(participantName(participant))}
            </strong>

            <small>
              ${
                escapeHtml(
                  CONNECTION_STATUS[
                    participant?.connection_status
                  ] ||
                  participant?.connection_status ||
                  "—"
                )
              }
              ·
              ${
                escapeHtml(
                  MEDIA_ROLES[
                    participant?.media_role
                  ] ||
                  participant?.media_role ||
                  "—"
                )
              }
            </small>
          </div>

          ${this.renderParticipantActions(participant)}
        </div>
      `)
      .join("");
  }

  renderError() {
    if (!this.state.error) {
      return "";
    }

    return `
      <div class="classroom-error" role="alert">
        ${escapeHtml(this.state.error)}
      </div>
    `;
  }
}

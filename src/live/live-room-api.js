import {
  get,
  post,
  put,
  remove
} from "../lib/api.js";

function normalizeSessionId(sessionId) {
  const value = Number(sessionId);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error("SESSION_ID_REQUIRED");
  }

  return value;
}


export async function getLiveKitToken(sessionId) {
  const id = Number(sessionId || 0);

  if (!Number.isInteger(id) || id < 1) {
    throw new Error("SESSION_ID_REQUIRED");
  }

  return post("/livekit-token", {
    session_id: id
  });
}


export function getLiveRoom(sessionId) {
  const id = normalizeSessionId(sessionId);

  return get(
    `/live-room?session_id=${encodeURIComponent(id)}`
  );
}

export function listRoomHosts(sessionId) {
  const id = normalizeSessionId(sessionId);

  return post("/live-room", {
    action: "list_hosts",
    session_id: id
  });
}

export function assignRoomHost(sessionId, userId) {
  const id = normalizeSessionId(sessionId);
  const user = Number(userId);

  if (!Number.isInteger(user) || user < 1) {
    throw new Error("TARGET_USER_REQUIRED");
  }

  return post("/live-room", {
    action: "assign_host",
    session_id: id,
    user_id: user
  });
}

export function assignRoomCohost(
  sessionId,
  userId,
  permissions = []
) {
  const id = normalizeSessionId(sessionId);
  const user = Number(userId);

  if (!Number.isInteger(user) || user < 1) {
    throw new Error("TARGET_USER_REQUIRED");
  }

  return post("/live-room", {
    action: "assign_cohost",
    session_id: id,
    user_id: user,
    permissions: Array.isArray(permissions)
      ? permissions
      : []
  });
}

export function updateRoomCohost(
  sessionId,
  userId,
  permissions = []
) {
  const id = normalizeSessionId(sessionId);
  const user = Number(userId);

  if (!Number.isInteger(user) || user < 1) {
    throw new Error("TARGET_USER_REQUIRED");
  }

  return post("/live-room", {
    action: "update_cohost",
    session_id: id,
    user_id: user,
    permissions: Array.isArray(permissions)
      ? permissions
      : []
  });
}

export function revokeRoomHost(sessionId, userId) {
  const id = normalizeSessionId(sessionId);
  const user = Number(userId);

  if (!Number.isInteger(user) || user < 1) {
    throw new Error("TARGET_USER_REQUIRED");
  }

  return post("/live-room", {
    action: "revoke_host",
    session_id: id,
    user_id: user
  });
}

export function revokeRoomCohost(sessionId, userId) {
  const id = normalizeSessionId(sessionId);
  const user = Number(userId);

  if (!Number.isInteger(user) || user < 1) {
    throw new Error("TARGET_USER_REQUIRED");
  }

  return post("/live-room", {
    action: "revoke_cohost",
    session_id: id,
    user_id: user
  });
}

export function joinLiveRoom(sessionId, studentId) {
  const id = normalizeSessionId(sessionId);

  const student = Number(studentId);

  if (!Number.isInteger(student) || student < 1) {
    throw new Error("STUDENT_ID_REQUIRED");
  }

  return post("/live-room", {
    action: "join",
    session_id: id,
    student_id: student
  });
}

export function createLiveRoom(sessionId) {
  const id = normalizeSessionId(sessionId);

  return post("/live-room", {
    action: "create",
    session_id: id
  });
}

export function getOrCreateLiveRoom(sessionId) {
  const id = normalizeSessionId(sessionId);

  return post("/live-room", {
    action: "get",
    session_id: id
  });
}

export function moderateLiveRoom(
  sessionId,
  participantId,
  action
) {
  const id = normalizeSessionId(sessionId);
  const participant = Number(participantId);

  if (!Number.isInteger(participant) || participant < 1) {
    throw new Error("PARTICIPANT_ID_REQUIRED");
  }

  if (!String(action || "").trim()) {
    throw new Error("LIVE_ROOM_ACTION_REQUIRED");
  }

  return put("/live-room", {
    action,
    session_id: id,
    participant_id: participant
  });
}

export function registerForSession(sessionId) {
  const id = normalizeSessionId(sessionId);

  return post("/session-registration", {
    action: "register",
    session_id: id
  });
}

export function cancelSessionRegistration(sessionId) {
  const id = normalizeSessionId(sessionId);

  return post("/session-registration", {
    action: "cancel_registration",
    session_id: id
  });
}

export function getSessionRegistration(sessionId) {
  const id = normalizeSessionId(sessionId);

  return get(
    `/session-registration?session_id=${encodeURIComponent(id)}`
  );
}

export function manageRegistrationWindow(
  sessionId,
  action,
  data = {}
) {
  const id = normalizeSessionId(sessionId);

  if (!String(action || "").trim()) {
    throw new Error("REGISTRATION_ACTION_REQUIRED");
  }

  return post("/session-registration", {
    action,
    session_id: id,
    ...data
  });
}

export function manageSessionTurn(
  sessionId,
  action,
  turnId,
  data = {}
) {
  const id = normalizeSessionId(sessionId);
  const turn = Number(turnId);

  if (!Number.isInteger(turn) || turn < 1) {
    throw new Error("TURN_ID_REQUIRED");
  }

  if (!String(action || "").trim()) {
    throw new Error("TURN_ACTION_REQUIRED");
  }

  return post("/session-registration", {
    action,
    session_id: id,
    turn_id: turn,
    ...data
  });
}

export function getLiveBoard(sessionId) {
  const id = normalizeSessionId(sessionId);

  return get(
    `/live-board?session_id=${encodeURIComponent(id)}`
  );
}

export function updateLiveBoard(sessionId, state) {
  const id = normalizeSessionId(sessionId);

  return put("/live-board", {
    session_id: id,
    action: "update",
    state
  });
}

export function clearLiveBoard(sessionId) {
  const id = normalizeSessionId(sessionId);

  return put("/live-board", {
    session_id: id,
    action: "clear"
  });
}

export function lockLiveBoard(sessionId) {
  const id = normalizeSessionId(sessionId);

  return put("/live-board", {
    session_id: id,
    action: "lock"
  });
}

export function unlockLiveBoard(sessionId) {
  const id = normalizeSessionId(sessionId);

  return put("/live-board", {
    session_id: id,
    action: "unlock"
  });
}


export function getQuranAnnotations(
  studentId,
  ayahId = null,
  sessionId = null
) {
  const params = new URLSearchParams();

  if (studentId) {
    params.set("student_id", studentId);
  }

  if (ayahId) {
    params.set("ayah_id", ayahId);
  }

  if (sessionId) {
    params.set("session_id", sessionId);
  }

  return get(`/quran-annotations?${params.toString()}`);
}

export function saveQuranAnnotation(
  studentId,
  ayahId,
  annotationType,
  annotationData = {},
  sessionId = null
) {
  return post("/quran-annotations", {
    student_id: studentId,
    ayah_id: ayahId,
    annotation_type: annotationType,
    annotation_data: annotationData,
    session_id: sessionId
  });
}

export function deleteQuranAnnotation(
  id,
  sessionId = null
) {
  const params = new URLSearchParams();

  params.set("id", id);

  if (sessionId) {
    params.set("session_id", sessionId);
  }

  return fetch(
    `/quran-annotations?${params.toString()}`,
    {
      method: "DELETE"
    }
  );
}


export function getQuranResources(
  ayahId,
  resourceType = null,
  sessionId = null
) {
  const ayah = Number(ayahId);

  const params = new URLSearchParams();

  if (ayah) {
    params.set("ayah_id", ayah);
  }

  if (resourceType) {
    params.set(
      "resource_type",
      resourceType
    );
  }

  if (sessionId) {
    params.set("session_id", sessionId);
  }

  return get(
    `/quran-resources?${params.toString()}`
  );
}

export function saveQuranResource(
  ayahId,
  resourceType,
  title = "",
  content = "",
  resourceData = {},
  sessionId = null
) {
  return post("/quran-resources", {
    ayah_id: ayahId,
    resource_type: resourceType,
    title,
    content,
    resource_data: resourceData,
    session_id: sessionId
  });
}

export function deleteQuranResource(
  id,
  sessionId = null
) {
  const params = new URLSearchParams();

  params.set("id", id);

  if (sessionId) {
    params.set("session_id", sessionId);
  }

  return fetch(
    `/quran-resources?${params.toString()}`,
    {
      method: "DELETE"
    }
  );
}

export function getSessionMaterials(sessionId) {
  const id = normalizeSessionId(sessionId);

  return get(
    `/session-materials?session_id=${encodeURIComponent(id)}`
  );
}

export function createSessionMaterial(
  sessionId,
  material = {}
) {
  const id = normalizeSessionId(sessionId);

  return post("/session-materials", {
    session_id: id,
    ...material
  });
}

export function updateSessionMaterial(
  materialId,
  material = {}
) {
  const id = Number(materialId);

  if (!Number.isInteger(id) || id < 1) {
    throw new Error("MATERIAL_ID_REQUIRED");
  }

  return put("/session-materials", {
    id,
    ...material
  });
}

export function deleteSessionMaterial(materialId) {
  const id = Number(materialId);

  if (!Number.isInteger(id) || id < 1) {
    throw new Error("MATERIAL_ID_REQUIRED");
  }

  return remove(
    `/session-materials?id=${encodeURIComponent(id)}`
  );
}

export function getClassroomAttendance(sessionId) {
  const id = normalizeSessionId(sessionId);
  return get(
    `/attendance?session_id=${encodeURIComponent(id)}`
  );
}

export function getClassroomWird(sessionId) {
  const id = normalizeSessionId(sessionId);
  return get(
    `/wird?session_id=${encodeURIComponent(id)}`
  );
}

export function getClassroomStudents(sessionId) {
  const id = normalizeSessionId(sessionId);
  return get(
    `/session-registration?session_id=${encodeURIComponent(id)}`
  );
}

export function saveClassroomAttendance(
  sessionId,
  studentId,
  status
) {
  const id = normalizeSessionId(sessionId);

  return post("/attendance", {
    session_id: id,
    student_id: Number(studentId),
    status
  });
}

export function saveClassroomEvaluation(
  sessionId,
  studentId,
  evaluation = {}
) {
  const id = normalizeSessionId(sessionId);

  return post("/quran-progress", {
    session_id: id,
    student_id: Number(studentId),
    ...evaluation
  });
}

// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  role: text("role", { enum: ["general_manager", "secretary", "doctor"] }).notNull(),
  passwordHash: text("password_hash"),
  passwordSalt: text("password_salt"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_users_email").on(table.email)]);

export const agendaAccess = sqliteTable("agenda_access", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  professionalId: text("professional_id").notNull(),
}, (table) => [uniqueIndex("idx_agenda_access_user_professional").on(table.userId, table.professionalId)]);

export const appState = sqliteTable("app_state", {
  id: integer("id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_sessions_token_hash").on(table.tokenHash)]);

export const agendaRequests = sqliteTable("agenda_requests", {
  id: text("id").primaryKey(),
  professionalId: text("professional_id").notNull(),
  appointmentId: text("appointment_id"),
  action: text("action", { enum: ["create", "update", "delete"] }).notNull(),
  proposedPayload: text("proposed_payload"),
  previousPayload: text("previous_payload"),
  status: text("status", { enum: ["pending", "accepted", "denied"] }).notNull().default("pending"),
  requestedBy: integer("requested_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  decidedBy: integer("decided_by").references(() => users.id, { onDelete: "set null" }),
  decisionNote: text("decision_note"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  decidedAt: text("decided_at"),
}, (table) => [index("idx_agenda_requests_professional_status").on(table.professionalId, table.status), index("idx_agenda_requests_requester").on(table.requestedBy)]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  message: text("message").notNull(),
  requestId: text("request_id").references(() => agendaRequests.id, { onDelete: "set null" }),
  readAt: text("read_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_notifications_user_created").on(table.userId, table.createdAt)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorName: text("actor_name").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  professionalId: text("professional_id"),
  appointmentId: text("appointment_id"),
  patientId: text("patient_id"),
  description: text("description").notNull(),
  metadata: text("metadata"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_audit_logs_created").on(table.createdAt), index("idx_audit_logs_professional").on(table.professionalId)]);

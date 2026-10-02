UPDATE "BoardColumn"
SET "color" = CASE "name"
  WHEN 'To Do' THEN '#64748b'
  WHEN 'In Progress' THEN '#3b82f6'
  WHEN 'In Review' THEN '#8b5cf6'
  WHEN 'Ready for QA' THEN '#f59e0b'
  WHEN 'Done' THEN '#22c55e'
END
WHERE "color" IS NULL
  AND "name" IN ('To Do', 'In Progress', 'In Review', 'Ready for QA', 'Done');

UPDATE "IssueFieldOption"
SET "color" = CASE
  WHEN "kind" = 'TYPE' AND "name" = 'TASK' THEN '#3b82f6'
  WHEN "kind" = 'TYPE' AND "name" = 'BUG' THEN '#ef4444'
  WHEN "kind" = 'TYPE' AND "name" = 'STORY' THEN '#22c55e'
  WHEN "kind" = 'TYPE' AND "name" = 'EPIC' THEN '#8b5cf6'
  WHEN "kind" = 'PRIORITY' AND "name" = 'LOW' THEN '#64748b'
  WHEN "kind" = 'PRIORITY' AND "name" = 'MEDIUM' THEN '#3b82f6'
  WHEN "kind" = 'PRIORITY' AND "name" = 'HIGH' THEN '#f97316'
  WHEN "kind" = 'PRIORITY' AND "name" = 'CRITICAL' THEN '#ef4444'
END
WHERE "color" IS NULL
  AND (
    ("kind" = 'TYPE' AND "name" IN ('TASK', 'BUG', 'STORY', 'EPIC'))
    OR
    ("kind" = 'PRIORITY' AND "name" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
  );

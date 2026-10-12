-- ISOLATED EXPERIMENT ONLY. No migration, reader cutover, backfill or production contract.
-- Uses the reviewed raw-string extractor. SSOT: docs/TRAINING_RULES.md, #6490 design.
CREATE TABLE fixture_reports(id uuid PRIMARY KEY, report jsonb NOT NULL);
CREATE TABLE fixture_memberships(
  report_id uuid NOT NULL, rider_key text COLLATE "C" NOT NULL, PRIMARY KEY(report_id,rider_key)
);
CREATE INDEX fixture_membership_rider ON fixture_memberships(rider_key);
CREATE FUNCTION fixture_member_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO fixture_memberships SELECT n.id,k FROM fixture_new n
    CROSS JOIN LATERAL training_seen_keys(n.report) k;
  RETURN NULL; END $$;
CREATE FUNCTION fixture_member_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  DELETE FROM fixture_memberships m USING fixture_old o
    WHERE m.report_id=o.id AND NOT EXISTS(SELECT 1 FROM fixture_new n
      CROSS JOIN LATERAL training_seen_keys(n.report) k WHERE n.id=o.id AND k=m.rider_key);
  INSERT INTO fixture_memberships SELECT n.id,k FROM fixture_new n
    CROSS JOIN LATERAL training_seen_keys(n.report) k
    WHERE NOT EXISTS(SELECT 1 FROM fixture_memberships m WHERE m.report_id=n.id AND m.rider_key=k);
  RETURN NULL; END $$;
CREATE FUNCTION fixture_member_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  DELETE FROM fixture_memberships m USING fixture_old o WHERE m.report_id=o.id;
  RETURN NULL; END $$;
CREATE TRIGGER fixture_insert AFTER INSERT ON fixture_reports REFERENCING NEW TABLE AS fixture_new
  FOR EACH STATEMENT EXECUTE FUNCTION fixture_member_insert();
CREATE TRIGGER fixture_update AFTER UPDATE ON fixture_reports REFERENCING OLD TABLE AS fixture_old NEW TABLE AS fixture_new
  FOR EACH STATEMENT EXECUTE FUNCTION fixture_member_update();
CREATE TRIGGER fixture_delete AFTER DELETE ON fixture_reports REFERENCING OLD TABLE AS fixture_old
  FOR EACH STATEMENT EXECUTE FUNCTION fixture_member_delete();

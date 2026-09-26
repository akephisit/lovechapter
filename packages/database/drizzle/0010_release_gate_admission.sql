CREATE FUNCTION ops.admit_release_lease(p_kind text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  gate_mode text;
  lease_id uuid;
BEGIN
  SELECT mode INTO STRICT gate_mode
  FROM ops.release_control
  WHERE id = 1
  FOR SHARE;

  IF gate_mode = 'maintenance' THEN
    RETURN NULL;
  END IF;
  IF gate_mode <> 'open' THEN
    RAISE EXCEPTION 'Invalid release control mode';
  END IF;

  lease_id := pg_catalog.gen_random_uuid();
  INSERT INTO ops.release_leases (id, kind) VALUES (lease_id, p_kind);
  RETURN lease_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ops.admit_release_lease(text) FROM PUBLIC;

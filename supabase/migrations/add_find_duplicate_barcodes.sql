-- RPC: restituisce tutte le righe duplicate (barcode condiviso da più ID) senza limiti
CREATE OR REPLACE FUNCTION find_duplicate_rows()
RETURNS SETOF shared_inventory
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT si.*
  FROM shared_inventory si
  INNER JOIN (
    SELECT barcode
    FROM shared_inventory
    WHERE barcode IS NOT NULL AND barcode != ''
    GROUP BY barcode
    HAVING count(*) > 1
  ) dupes ON si.barcode = dupes.barcode
  ORDER BY si.barcode
$$;

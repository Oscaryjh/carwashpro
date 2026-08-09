"use client";

import { useCallback, useEffect, useState } from "react";

export function useFinancialOperationId(prefix: string) {
  const createOperationId = useCallback(
    () => `${prefix}:${crypto.randomUUID()}`,
    [prefix],
  );
  const [operationId, setOperationId] = useState("");
  useEffect(() => {
    setOperationId((current) => current || createOperationId());
  }, [createOperationId]);
  const rotateOperationId = useCallback(
    () => setOperationId(createOperationId()),
    [createOperationId],
  );

  return { operationId, rotateOperationId };
}

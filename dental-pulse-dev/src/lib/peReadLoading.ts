/** PE read queries: show section skeletons while loading or refetching (Invoices tab pattern). */
export function peReadPending(query: {
  isLoading?: boolean;
  isFetching?: boolean;
  isPending?: boolean;
}): boolean {
  return Boolean(query.isLoading || query.isFetching || query.isPending);
}

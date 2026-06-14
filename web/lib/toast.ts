export type ToastType = "success" | "error";

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

type Listener = (toast: Toast) => void;

let nextId = 0;
const listeners = new Set<Listener>();

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function showToast(message: string, type: ToastType = "success") {
  const toast: Toast = { id: ++nextId, message, type };
  listeners.forEach((listener) => listener(toast));
}

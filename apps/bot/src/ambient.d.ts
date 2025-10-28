declare module 'uuid' {
  export function v4(): string;
}

declare module 'pg' {
  export class Pool {
    constructor(config?: any);
    query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }>;
    connect(): Promise<any>;
    end(): Promise<void>;
    on(event: string, listener: (err: unknown) => void): void;
  }
}

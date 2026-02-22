module.exports = {
  apps: [
    {
      name: "capture-hub",
      script: "server/index.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: "/mnt/ssd/capture-hub/app",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        DATABASE_URL: "/mnt/ssd/capture-hub/data/todo.db",
        AUTH_TOKEN: "CHANGE_ME",
      },
      max_memory_restart: "100M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/mnt/ssd/capture-hub/logs/error.log",
      out_file: "/mnt/ssd/capture-hub/logs/out.log",
    },
  ],
};

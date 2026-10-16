const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const WATCHDOG_INTERVAL_SECONDS = 3;
const THUNDERBIRD_COMMAND = ["thunderbird"];
const THUNDERBIRD_PROCESS = "thunderbird-bin";

function TrayBird(orientation, panel_height, instance_id) {
  this._init(orientation, panel_height, instance_id);
}

TrayBird.prototype = {
  __proto__: Applet.IconApplet.prototype,

  _init: function (orientation, panel_height, instance_id) {
    Applet.IconApplet.prototype._init.call(
      this,
      orientation,
      panel_height,
      instance_id,
    );

    this.instance_id = instance_id;
    this._startup_timeout = null;
    this._watchdog_id = null;
    this._removed = false;
    this._quitting = false;
    this._launching = false;

    this.set_applet_icon_name("mail-unread-symbolic");
    this.set_applet_tooltip(_("TrayBird"));

    this._create_menu();
    this._start_and_hide_thunderbird();
    this._start_watchdog();
  },

  _create_menu: function () {
    this.quit_item = new PopupMenu.PopupIconMenuItem(
      _("Quit"),
      "application-exit-symbolic",
      St.IconType.SYMBOLIC,
    );

    this.quit_item.connect("activate", Lang.bind(this, this._quit_thunderbird));

    this._applet_context_menu.addMenuItem(this.quit_item);
  },

  on_applet_clicked: function () {
    if (this._quitting) return;

    this._toggle_thunderbird();
  },

  _run_cmd: function (command, callback) {
    let done = callback || function () {};

    try {
      let proc = Gio.Subprocess.new(
        command,
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
      );

      proc.communicate_utf8_async(
        null,
        null,
        Lang.bind(this, function (p, res) {
          let stdout = "";

          try {
            let result = p.communicate_utf8_finish(res);
            stdout = result[1] || "";
          } catch (e) {
            global.logError("TrayBird: " + command.join(" ") + ": " + e);
          }

          if (this._removed) return;

          done(stdout.trim());
        }),
      );
    } catch (e) {
      global.logError("TrayBird: " + command.join(" ") + ": " + e);
      done("");
    }
  },

  _get_thunderbird_pid: function (callback) {
    this._run_cmd(["pgrep", "-o", "-x", THUNDERBIRD_PROCESS], callback);
  },

  _get_thunderbird_window: function (callback) {
    this._get_thunderbird_pid(
      Lang.bind(this, function (pid) {
        if (!pid) {
          callback(null);
          return;
        }

        this._run_cmd(
          ["wmctrl", "-lp"],
          Lang.bind(this, function (output) {
            if (!output) {
              callback(null);
              return;
            }

            let lines = output.split("\n");

            for (let i = 0; i < lines.length; i++) {
              let columns = lines[i].trim().split(/\s+/);

              if (columns.length >= 5 && columns[2] === pid) {
                callback(columns[0]);
                return;
              }
            }

            callback(null);
          }),
        );
      }),
    );
  },

  _is_window_hidden: function (window_id, callback) {
    this._run_cmd(
      ["xprop", "-id", window_id, "_NET_WM_STATE"],
      Lang.bind(this, function (state) {
        callback(state.indexOf("_NET_WM_STATE_HIDDEN") !== -1);
      }),
    );
  },

  _start_watchdog: function () {
    this._watchdog_id = Mainloop.timeout_add_seconds(
      WATCHDOG_INTERVAL_SECONDS,
      Lang.bind(this, function () {
        if (this._removed || this._quitting) {
          this._watchdog_id = null;
          return false;
        }

        if (this._launching) return true;

        this._get_thunderbird_pid(
          Lang.bind(this, function (pid) {
            if (pid || this._launching || this._quitting) return;

            this._start_and_hide_thunderbird();
          }),
        );

        return true;
      }),
    );
  },

  _start_and_hide_thunderbird: function () {
    this._launching = true;

    this._get_thunderbird_pid(
      Lang.bind(this, function (pid) {
        if (pid) {
          this._wait_for_thunderbird_window();
          return;
        }

        if (!this._start_thunderbird()) return;

        this._wait_for_thunderbird_window();
      }),
    );
  },

  _wait_for_thunderbird_window: function () {
    if (this._removed || this._quitting) {
      this._launching = false;
      return;
    }

    this._launching = true;

    this._get_thunderbird_window(
      Lang.bind(this, function (window_id) {
        if (this._removed || this._quitting) {
          this._launching = false;
          return;
        }

        if (window_id) {
          this._hide_thunderbird();
          this._startup_timeout = null;
          this._launching = false;
          return;
        }

        this._startup_timeout = Mainloop.timeout_add(
          500,
          Lang.bind(this, function () {
            this._startup_timeout = null;
            this._wait_for_thunderbird_window();
            return false;
          }),
        );
      }),
    );
  },

  _show_thunderbird: function () {
    this._get_thunderbird_window(
      Lang.bind(this, function (window_id) {
        if (!window_id) {
          if (this._launching) return;

          this._launching = true;

          if (!this._start_thunderbird()) return;

          this._wait_for_thunderbird_window();
          return;
        }

        this._run_cmd(
          [
            "wmctrl",
            "-i",
            "-r",
            window_id,
            "-b",
            "remove,skip_taskbar,skip_pager",
          ],
          Lang.bind(this, function () {
            this._run_cmd(
              ["xdotool", "windowmap", window_id],
              Lang.bind(this, function () {
                this._run_cmd(["xdotool", "windowactivate", window_id]);
              }),
            );
          }),
        );
      }),
    );
  },

  _hide_thunderbird: function () {
    this._get_thunderbird_window(
      Lang.bind(this, function (window_id) {
        if (!window_id) return;

        this._run_cmd(
          ["xdotool", "windowminimize", window_id],
          Lang.bind(this, function () {
            this._run_cmd([
              "wmctrl",
              "-i",
              "-r",
              window_id,
              "-b",
              "add,skip_taskbar,skip_pager",
            ]);
          }),
        );
      }),
    );
  },

  _toggle_thunderbird: function () {
    this._get_thunderbird_window(
      Lang.bind(this, function (window_id) {
        if (!window_id) {
          this._show_thunderbird();
          return;
        }

        this._is_window_hidden(
          window_id,
          Lang.bind(this, function (hidden) {
            if (hidden) {
              this._show_thunderbird();
            } else {
              this._hide_thunderbird();
            }
          }),
        );
      }),
    );
  },

  _start_thunderbird: function () {
    try {
      Util.spawn(THUNDERBIRD_COMMAND);
      return true;
    } catch (e) {
      global.logError(
        "TrayBird: could not start " + THUNDERBIRD_COMMAND.join(" ") + ": " + e,
      );
      this._launching = false;
      return false;
    }
  },

  _quit_thunderbird: function () {
    this._quitting = true;
    this._launching = false;

    if (this._watchdog_id) {
      Mainloop.source_remove(this._watchdog_id);
      this._watchdog_id = null;
    }

    if (this._startup_timeout) {
      Mainloop.source_remove(this._startup_timeout);
      this._startup_timeout = null;
    }

    this._run_cmd(["pkill", "-x", THUNDERBIRD_PROCESS]);

    this._applet_context_menu.close();
    this.actor.hide();
  },

  on_applet_removed_from_panel: function () {
    this._removed = true;

    if (this._watchdog_id) {
      Mainloop.source_remove(this._watchdog_id);
      this._watchdog_id = null;
    }

    if (this._startup_timeout) {
      Mainloop.source_remove(this._startup_timeout);
      this._startup_timeout = null;
    }

    if (this.quit_item) this.quit_item.destroy();
  },
};

function main(metadata, orientation, panel_height, instance_id) {
  return new TrayBird(orientation, panel_height, instance_id);
}

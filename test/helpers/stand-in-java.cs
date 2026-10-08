// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

// A stand-in for Java on Windows — see stand-in-java.ts, which compiles this.
//
// Asked for its version it answers the way a JVM does, with a banner on stderr.
// Started as the game it writes down what it was started with, beside itself,
// and then does what the file `<itself>.does` names:
//
//   window   opens a window, says so, and stays until the window is closed
//   wait     says it is staying, and stays, with no window to be asked through
//   (none)   leaves at once
//
// Built as a program without a console, as `javaw.exe` is: what it prints goes
// down the pipes it was started with and nowhere else.

using System;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

static class StandIn
{
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "-version")
        {
            Console.Error.WriteLine("openjdk version \"21.0.3\" 2024-04-16");
            Console.Error.WriteLine("OpenJDK Runtime Environment Temurin-21.0.3+9 (build 21.0.3+9)");
            return 0;
        }

        string self = Assembly.GetExecutingAssembly().Location;
        File.WriteAllLines(self + ".args", args);
        File.WriteAllText(self + ".cwd", Directory.GetCurrentDirectory());

        string does = File.Exists(self + ".does") ? File.ReadAllText(self + ".does").Trim() : "";
        if (does == "window")
        {
            Form window = new Form();
            window.Text = "Stand-in game";
            window.Shown += delegate
            {
                Console.Out.WriteLine("[12:00:00] [main/INFO]: The window is up");
                Console.Out.Flush();
            };
            Application.Run(window);
            return 0;
        }
        if (does == "wait")
        {
            Console.Out.WriteLine("[12:00:00] [main/INFO]: Staying, with no window");
            Console.Out.Flush();
            Thread.Sleep(Timeout.Infinite);
        }
        return 0;
    }
}

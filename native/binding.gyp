{
  "targets": [
    {
      "target_name": "capture_addon",
      "sources": [
        "binding.cpp",
        "capture.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags_cc": ["-std=c++17"],
      "defines": [
        "NODE_ADDON_API_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        ['OS=="mac"', {
          "xcode_settings": {
            "MACOSX_DEPLOYMENT_TARGET": "12.3",
            "OTHER_LDFLAGS": [
              "-framework ScreenCaptureKit",
              "-framework Cocoa",
              "-framework Foundation"
            ]
          }
        }],
        ['OS=="win"', {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": ["/std:c++17"]
            }
          },
          "libraries": [
            "windows.graphics.capture.lib",
            "d3d11.lib",
            "dxgi.lib"
          ]
        }],
        ['OS=="linux"', {
          "cflags_cc": ["`pkg-config --cflags pipewire-0.3 libx11`"],
          "ldflags": ["`pkg-config --libs pipewire-0.3 libx11`"]
        }]
      ]
    }
  ]
}
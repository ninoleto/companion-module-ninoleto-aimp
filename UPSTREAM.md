# Provenance

Companion module source: https://github.com/bitfocus/companion-module-aimp-audioplayer

Tag: v2.0.1; commit: 45146294ef4561ef9c18572415c0e8da3d7be4d2.
Original MIT copyright: 2026 Bitfocus AS - Open Source. Upstream maintainers credited in their source: mikle103 and fursyt12 / SLV Tech.

This fork retains and adapts upstream action, feedback, state, variable and test code. The transport, connection lifecycle, inventory loading and preset catalog were revised for the private AIMP Companion Control bridge. Original notices and dependency licences are retained.

Native protocol targets: AIMP Companion Control 0.3.0 preview (complete new control families), with 0.2.1 and 0.1.0 compatibility for their existing controls. Its portable protocol.cpp/protocol.h are copied unchanged under test/native-fixture for interoperability checks. The native plugin derives from https://github.com/slv-tech/AIMP-Remote-Control-Server at tag v2.0.0, commit b42fccd65c964535fcfbdcc760967ccb27b48bf4, MIT / SLV Tech. Its license is retained alongside the fixture.

Runtime dependencies: @companion-module/base 2.1.3 and ws 8.21.0. Official module builder: @companion-module/tools 3.1.0. Host integration checks: @companion-module/host 1.2.1 (development-only). The build tool embeds dependency license notices into the package LICENSE.

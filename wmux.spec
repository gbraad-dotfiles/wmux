Name:           wmux
Version:        1.0.2
Release:        1%{?dist}
Summary:        Web-based tmux controller with mouse support

License:        MIT
URL:            https://github.com/gbraad/wmux
Source0:        %{name}-%{version}.tar.gz

%global debug_package %{nil}

BuildRequires:  golang >= 1.18
Requires:       tmux >= 3.0
Requires:       systemd
Recommends:     tailscale

%description
wmux is a web-based interface for controlling tmux sessions with full mouse
support, Tailscale security by default, and multi-host capabilities.

%prep
%setup -q

%build
go build -o wmux

%install
# Install binary
install -D -m 0755 wmux %{buildroot}%{_bindir}/wmux

# Install systemd service files
install -D -m 0644 wmux@.service %{buildroot}%{_unitdir}/wmux@.service
install -D -m 0644 wmux-multi@.service %{buildroot}%{_unitdir}/wmux-multi@.service

%post
%systemd_post wmux@.service
%systemd_post wmux-multi@.service

%preun
%systemd_preun wmux@.service
%systemd_preun wmux-multi@.service

%postun
%systemd_postun_with_restart wmux@.service
%systemd_postun_with_restart wmux-multi@.service

%files
%license LICENSE
%doc README.md
%{_bindir}/wmux
%{_unitdir}/wmux@.service
%{_unitdir}/wmux-multi@.service

%changelog
* Sun Apr 05 2026 Gerard Braad <me@gbraad.nl> - 1.0.2-1
- Android support
- Self-signed connection flow
- Embed public folder

* Thu Apr 02 2026 Gerard Braad <me@gbraad.nl> - 1.0.0-1
- Initial RPM release
- Single-host and multi-host modes
- Tailscale security by default
- Full mouse support

Name:           wmux
Version:        1.0.0
Release:        1%{?dist}
Summary:        Web-based tmux controller with mouse support

License:        MIT
URL:            https://github.com/gbraad/wmux
Source0:        %{name}-%{version}.tar.gz

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

# Install web assets
mkdir -p %{buildroot}%{_datadir}/wmux/public
cp -r public/* %{buildroot}%{_datadir}/wmux/public/

# Install systemd service files
install -D -m 0644 wmux@.service %{buildroot}%{_unitdir}/wmux@.service
install -D -m 0644 wmux-multi@.service %{buildroot}%{_unitdir}/wmux-multi@.service

# Create symlink so binary can find public/ directory
ln -s ../share/wmux/public %{buildroot}%{_bindir}/public

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
%{_bindir}/public
%{_datadir}/wmux/
%{_unitdir}/wmux@.service
%{_unitdir}/wmux-multi@.service

%changelog
* Thu Apr 02 2026 Gerard Braad <me@gbraad.nl> - 1.0.0-1
- Initial RPM release
- Single-host and multi-host modes
- Tailscale security by default
- Full mouse support
- Android app support

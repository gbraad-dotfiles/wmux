#!/bin/bash
set -e

VERSION="1.0.2"
NAME="wmux"

echo "Building RPM for $NAME v$VERSION..."

# Create RPM build structure
mkdir -p ~/rpmbuild/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

# Create source tarball
TMPDIR=$(mktemp -d)
SRCDIR="$TMPDIR/$NAME-$VERSION"
mkdir -p "$SRCDIR"

# Copy source files
cp -r *.go go.mod go.sum public/ wmux@.service wmux-multi@.service README.md "$SRCDIR/"

# Create LICENSE if it doesn't exist
if [ ! -f LICENSE ]; then
    echo "MIT License - see README.md" > "$SRCDIR/LICENSE"
fi

# Create tarball
cd "$TMPDIR"
tar czf ~/rpmbuild/SOURCES/$NAME-$VERSION.tar.gz $NAME-$VERSION/
cd -

# Copy spec file
cp wmux.spec ~/rpmbuild/SPECS/

# Build RPM
rpmbuild -ba ~/rpmbuild/SPECS/wmux.spec

echo ""
echo "Build complete!"
echo "RPMs location: ~/rpmbuild/RPMS/"
echo "Source RPM: ~/rpmbuild/SRPMS/"
echo ""
echo "Install with: sudo rpm -ivh ~/rpmbuild/RPMS/x86_64/$NAME-$VERSION-1.*.x86_64.rpm"
echo "Or: sudo dnf install ~/rpmbuild/RPMS/x86_64/$NAME-$VERSION-1.*.x86_64.rpm"

# Cleanup
rm -rf "$TMPDIR"

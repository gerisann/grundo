# GRUNDO útvonalmotor — Cloud Run konténer.
#
# FIGYELEM: a build kontextusa EZ A MAPPA (`graphhopper/`), nem a repo
# gyökere — ellentétben a `server/Dockerfile`-lal, ennek nincs szüksége a
# közös játékmotorra.
#
#   docker build -t grundo-graphhopper .
#
# A gráf ITT, BUILD KÖZBEN épül fel (lásd lent), nem induláskor. Enélkül
# minden induláskor (hidegindítás is!) újra kellene importálni Magyarország
# egész úthálózatát — percekig tartana kérés helyett válasz helyett.

FROM eclipse-temurin:21-jre-jammy

WORKDIR /gh

# `curl` kell a jar és az OSM-kivonat letöltéséhez — a temurin `jre` alapkép
# nem tartalmazza.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# A verzió RÖGZÍTVE, ugyanaz, mint a `README.md` helyi indítási utasításában.
# Egy jövőbeli GraphHopper-kiadás így nem töri némán a buildet.
RUN curl -fL -o graphhopper-web-11.0.jar \
    https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/11.0/graphhopper-web-11.0.jar

COPY config-cloudrun.yml .
COPY custom_models/ custom_models/

# Az OSM-kivonat CSAK az importhoz kell. A kész gráf (`graph-cache/`) ettől a
# ponttól független — ezért törölhető a build végén, és a KÉSZ KÉPBEN nem
# szerepel a 309 MB-os fájl.
RUN curl -fL -o hungary-latest.osm.pbf \
    https://download.geofabrik.de/europe/hungary-latest.osm.pbf

# Az `import` (nem `server`) parancs csak felépíti a gráfot, szervert nem
# indít — ez fut le a `graphhopper/README.md` „Helyi futtatás" szakaszában
# is az ELSŐ indításkor, itt viszont build közben, egyszer.
#
# ⚠️ -Xmx4g KELL AZ IMPORTHOZ, nem a kiszolgáláshoz (mérve, README). A Cloud
# Build lépésnek ezért nagyobb géptípus kell, mint az alapértelmezett — lásd
# `cloudbuild.yaml` → `options.machineType`. Ha ez a sor „Java heap space”
# hibával hasal el, a build géptípusa túl kicsi, nem ez a parancs a hibás.
RUN java -Xmx4g -jar graphhopper-web-11.0.jar import config-cloudrun.yml \
    && rm hungary-latest.osm.pbf

EXPOSE 8080

# ⚠️ AZ 1536m TARTALÉKOT HAGY, NEM A MÉRT MINIMUM. Élőben mérve (2026-08-29)
# már -Xmx1g heap mellett is elindult 8 s alatt, és kiszolgált egy valódi
# kör-tervezést ~365 ms alatt, memóriahiba nélkül — az 1536m ehhez képest
# biztonsági tartalék, nem az, ami épphogy elég. A konténer `--memory=2Gi`-t
# kap (lásd `cloudbuild.yaml`), hogy a heapen kívüli JVM- és OS-többlet is
# beleférjen.
CMD ["java", "-Xmx1536m", "-jar", "graphhopper-web-11.0.jar", "server", "config-cloudrun.yml"]

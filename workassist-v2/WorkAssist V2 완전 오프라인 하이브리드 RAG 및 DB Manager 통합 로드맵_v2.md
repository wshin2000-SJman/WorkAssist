
우리가 논의해 온 **프로젝트 중심의 자산 격리 및 Oxigraph(RDF/RocksDB) 전환 전략**, 그리고 새롭게 설계한 **History Manager 모듈**의 사양을 기존 파일 내용과 완벽하게 융합했습니다.

단 한 글자의 누락이나 생략 없이, 기존의 이기종 부품 수용을 위한 SQLite JSON 스키마 구조와 `calamine` 엑셀 파서 기능까지 조화롭게 통합하여 작성한 최종 문서입니다.

아래 코드 블록 우측 상단의 **'복사(Copy)'** 버튼을 눌러 **`WorkAssist V2 완전 오프라인 하이브리드 RAG 및 DB Manager 통합 로드맵_v2.md`** 파일로 저장한 뒤 안티그래비티(Antigravity)에 주입하시면 됩니다.

Markdown

```
# [최종 고도화 계획안] WorkAssist V2: 완전 오프라인 하이브리드 RAG 및 DB/History Manager 통합 로드맵

WorkAssist V2의 철저한 **'기능별 모듈화(Modular Architecture)'** 원칙에 따라, 사용자 개인이 매일 수정하고 추가하는 **개인 업무 데이터(SQLite)**와 실무 엔지니어링 결과물 및 제조사 카탈로그가 포함된 **회사 공통 지식 자산 DB**를 물리적으로 완벽히 격리(Decoupling)합니다.

기존 파이프라인을 건드리지 않고, 전사 기술 자산을 통합 제어하는 독립된 관리 레이어인 `DB Manager` 및 `History Manager`가 유기적으로 작동하도록 설계한 통합 개발 계획안입니다.

---

## 1. 시스템 아키텍처 및 모듈화 구조 (Modular Architecture)

WorkAssist V2는 각 기능이 엄격하게 분리되어 상호 의존성을 최소화합니다. 사용자의 개인 데이터 영역(`workassist_user.db`)은 기존대로 유지하되, 공통 지식 자산 영역(`workassist_knowledge.shared`)은 인메모리 방식(`petgraph`)의 메모리 한계를 탈피하고 디스크 기반의 초고속 시맨틱 맵인 **Oxigraph(RocksDB)** 및 **LanceDB**로 통일합니다.

```

┌────────────────────────────────────────────────────────────────────────┐

│ [ WorkAssist GUI 단일 앱 ] │

├────────────────────────────┬───────────────────────────────────────────┤

│ ▶ RAG Ingestion 모듈 │ ▶ NEW: DB & History Manager │

├────────────────────────────┼───────────────────────────────────────────┤

│ * OpenDataLoader PDF 제어 │ * 지식 그래프 RDF 토폴로지 시각화 │

│ * 로컬 텍스트 청킹/정제 │ * 기술 사양 데이터 그리드 CRUD │

│ * 로컬 임베딩 연산 (ort) │ * 엑셀 BOM 및 핵심 산출물 통합 인덱싱 │

└────────────┬───────────────┴─────────────────────┬─────────────────────┘

│ │

└─────────────────┬───────────────────┘

▼

[ 격리형 로컬 스토리지 엔지니어링 레이어 (Two-Track Storage) ]

- 개인 업무 스토리지: SQLite (Tasks, Minutes, 순수 개인 Projects)

- 공통 지식 자산 스토리지: Oxigraph (RDF/RocksDB) + LanceDB (벡터)

````

---

## 2. 이기종 기술 사양 수용 및 지식 자산 매핑 설계

### 2.1 이기종 부품 사양 수용을 위한 SQLite 하이브리드 스케일링
모터, 드라이버, 실린더 등 부품 종류에 따라 기술 사양이 서로 달라 매번 새로운 DB 스키마/테이블을 생성해야 하는 문제를 해결하기 위해, 공통 메타데이터 컬럼과 동적 상세 사양을 저장하는 **SQLite JSON 필드 기반의 하이브리드 스토리지 스키마**를 유지 및 활용합니다.

#### SQLite 스펙 통합 테이블 스키마 (`specs`)
```sql
CREATE TABLE IF NOT EXISTS specs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_number TEXT UNIQUE NOT NULL,      -- 품명/부품번호 (예: TBM2G-024)
    category TEXT NOT NULL,                -- 카테고리 (예: Motor, Driver, Gearbox)
    manufacturer TEXT NOT NULL,            -- 제조사 (예: Kollmorgen, Yaskawa)
    catalog_name TEXT,                     -- 출처 카탈로그 PDF 파일명
    description TEXT,                      -- 요약 설명
    spec_data TEXT NOT NULL,               -- 카테고리별 상이한 세부 사양 (JSON 문자열)
    created_at TEXT NOT NULL
);
````

#### JSON 세부 사양 적재 포맷 설계 예시

- **모터 사양 (`category = 'Motor'`)**
    
    JSON
    
    ```
    {
      "rated_torque": "2.4 Nm",
      "voltage_input": "48 Vdc",
      "max_rpm": 3000,
      "feedback_type": "Resolver"
    }
    ```
    
- **드라이버 사양 (`category = 'Driver'`)**
    
    JSON
    
    ```
    {
      "output_current": "5 A",
      "control_mode": "EtherCAT",
      "supported_phases": 3,
      "cooling_method": "Natural"
    }
    ```
    

### 2.2 Oxigraph 기반 데이터 매핑 구조 (RDF Ontology 설계)

모든 정형 지식, 부품 간 호환성 패턴, 사내 프로젝트 완료 히스토리는 W3C 글로벌 표준인 `주어(Subject) - 술어(Predicate) - 목적어(Object)` 형태의 RDF 트리플 사양으로 변환되어 Oxigraph 온디스크 스토어에 영구 저장(Persistence)됩니다.

코드 스니펫

```
# 1. 부품 카탈로그 관계 (Component Topology)
workassist:Part_MAXON_ECX22  rdf:type                      workassist:Component .
workassist:Part_MAXON_ECX22  workassist:partNumber         "MAXON-ECX-22" .
workassist:Part_MAXON_ECX22  workassist:compatibleWith     workassist:Part_ENCODER_12X .

# 2. History Manager를 통한 전사 엔지니어링 자산 융합
workassist:PRJ_2026_DRONE    rdf:type                      workassist:Project .
workassist:PRJ_2026_DRONE    workassist:projectCode         "PRJ-2026-DRONE" .
workassist:PRJ_2026_DRONE    workassist:customer            "삼성중공업" .
workassist:PRJ_2026_DRONE    workassist:hasBOMItem          workassist:BOM_Item_01 .
workassist:BOM_Item_01       workassist:partNumber          "MAXON-ECX-22" .
workassist:BOM_Item_01       workassist:quantity            "4"^^xsd:integer .
```

## 3. 핵심 기능 모듈 정의

### ① 신설: History Manager (전사 엔지니어링 히스토리 주입기)

프로젝트 진행 과정의 무수한 변경 사항이 담기는 실시간 업무 데이터(Task, Minutes)는 개인 SQLite 영역에 남겨두고, 검증이 끝난 최종 결과물 및 산출물을 전사 지식 DB에 일괄 적재(Ingestion)하는 모듈입니다.

- **프로젝트 정보 입력:** 프로젝트명, 프로젝트 코드, 담당자, 고객사 정보, 프로젝트 개요를 정형 입력받아 Oxigraph RDF 트리플로 변환합니다.
    
- **엑셀 BOM 파싱 인게스션:** Pure-Rust 고성능 엑셀 파서인 `calamine` 라이브러리를 통해 부품명세서(`.xlsx`)를 고속으로 읽어내어, 어떤 프로젝트에 어떤 부품 형번이 몇 개 사용되었는지 나타내는 정확한 관계 물리 네트워크를 Oxigraph에 빌드합니다.
    
- **주요 설계 문서 인덱싱:** 요구사양서, 설계명세서, DR(Design Review) 자료 등 핵심 산출물 PDF를 `opendataloader-pdf` 엔진으로 파싱하여 `project_code` 메타태그가 바인딩된 형태의 벡터로 LanceDB에 증분 적재합니다.
    

### ② DB Manager: 지식 그래프 시각화 및 수동 관계 편집 (Graph Curation)

- **기능:** Oxigraph에 영구 저장된 부품 간의 호환성망과 프로젝트 실무 레퍼런스 지식망을 프론트엔드 UI에 노드-링크 다이어그램 형태로 렌더링합니다.
    
- **모듈화 구현:** 안티그래비티 AI 에이전트를 통해 SPARQL 쿼리 결과 셋을 프론트엔드 시각화 엔진(d3.js) 바인딩용 계층 JSON 구조(`{ nodes: [], links: [] }`)로 자원 소유권 이동 없이 고속 매핑하는 Rust 래퍼 브릿지를 가동합니다. 관계 수정 시 `DELETE DATA` / `INSERT DATA` SPARQL 문이 원자적으로 실행됩니다.
    

### ③ DB Manager: 기술 사양 데이터 그리드 편집 (Metadata CRUD)

- **기능:** `opendataloader-pdf` 및 엑셀 파서가 자동 추출하여 DB에 적재한 품번별 상세 기술 사양 수치를 유저가 엑셀 형태의 그리드 뷰로 확인하고 직접 수정/보정(Curation)하는 휴먼 인 더 루프(Human-in-the-loop) 레이어입니다. 타입 밸리데이션 검증을 거쳐 수치 정밀도를 보장함으로써 할루시네이션을 0%로 통제합니다.
    

### ④ DB Manager: 지식 데이터 독립 삭제 및 청소 (Data Purge & Clean)

- **기능:** 특정 카탈로그 단종이나 오파싱된 프로젝트 지식을 도려내야 할 때, 타 데이터 손상 없이 특정 영역만 완전 숙청(Purge)합니다.
    
- **모듈화 구현:** SQLite의 `ON DELETE CASCADE` 트리거와 동시에, Oxigraph 스토어 내에서 해당 엔티티 URI를 포함하는 모든 트리플을 소거하는 `DELETE WHERE { ?s ?p <TargetURI> }` 트랜잭션을 묶어 데이터 고립 현상을 방지하고 LanceDB 벡터 데이터도 동시 소거합니다.
    

## 4. 업데이트된 완전 오프라인 데이터 파이프라인

업무 매니저 데이터의 오염 위험성을 걷어내고, 정제된 최종 산출물(History)과 이기종 규격 사양서 데이터만 깔끔하게 유기적으로 융합하는 피드백 루프입니다.

```
 [제조사 PDF 카탈로그] ──► [ opendataloader-pdf ] ──► [ 오프라인 텍스트/표 구조 추출 ] ┐
                                                                                    ├─► [ 공통 지식 스토리지 ]
[사내 핵심 산출물 PDF] ──► [ opendataloader-pdf ] ──► [ 프로젝트 코드 메타 바인딩 ]  │   - Oxigraph (RDF/RocksDB)
                                                                                    │   - LanceDB (의미론적 벡터)
  [엑셀 기반 실무 BOM] ──► [ calamine (Pure Rust) ] ──► [ 행-열 부품 형번/수량 매핑 ] ┘
                                                                                               │
                                                                                               ▼
                                                                                    ┌────────────────────┐
                                                                                    │   NEW: DB Manager  │
                                                                                    └──────────┬─────────┘
                                                                                               │
                         ┌─────────────────────────────────────┴─────────────────────────────────────┐
                         ▼                                     ▼                                     ▼
          [ SPARQL 지식 그래프 수동 편집 ]       [ 스펙 데이터 그리드 교정/CRUD ]           [ 지식 자산 트랜잭션 일괄 삭제 ]
```

## 5. 런타임 하이브리드 검색 프로세스 (초고속 오프라인 조회)

사용자가 검색창에 질문을 입력하면, 외부 서버 통신 및 LLM 문장 생성 레이턴시 전혀 없이 **단 10~50ms 이내**에 로컬 자원만으로 하이브리드 검색을 수행하여 고가독성 기술 자산 대시보드 화면을 즉시 띄웁니다.

```
[유저 자연어 입력] ➔ "MAXON-ECX-22 모터 설계 이력 및 스펙"
       │
       ├─► ① 맥락 검색: [ort (MiniLM)] ──► [LanceDB] 의미 유사도 기반 과거 사양서/DR 문서 본문 매칭
       │
       └─► ② 시맨틱 검색: [Oxigraph (SPARQL 쿼리 단 한 번)] 
                 │
                 └─► "모터 정형 기술 스펙, 물리적 호환 부품군, 
                      해당 모터가 실제 적용되었던 사내 과거 프로젝트 히스토리(BOM 기반 수량, 고객사, 담당자) 
                      다중 조인 일괄 상속 출력"
```

## 6. 수정된 3~4주 차 개발 로드맵 (Milestones)

- **1단계: 인프라 및 사이드카 연동 (1주 차) - 완료**
    
    - WorkAssist V2 핵심 환경 구성 및 필수 크레이트 셋팅.
        
    - `opendataloader-pdf` 배포 패키징 및 Rust 비동기 서브프로세스 호출 아키텍처 검증.
        
- **2단계: 네이티브 하이브리드 스토리지 및 구조화 엔진 구축 (2주 차) - 완료**
    
    - SQLite 메타 데이터 연동 및 `ort` 기반 로컬 임베딩 파이프라인 완성.
        
    - `specs` 테이블 통합 JSON 적재 설계 반영.
        
- **3단계: NEW - History Manager 및 Oxigraph 지식 그래프 구현 (3주 차) - 현재 단계**
    
    - `petgraph` 의존성을 전면 제거하고 RocksDB 내장형 `oxigraph` 스토어 이식.
        
    - `calamine` 기반 오프라인 엑셀 BOM 파서 기능 및 RDF 온톨로지 빌더 개발.
        
    - 안티그래비티 가동을 통한 SPARQL 자동 생성 엔진 및 d3.js 시각화 연동용 JSON 변환 브릿지 구축.
        
    - History Manager 전용 UI 탭(BOM Import 카드, 산출물 등록 아코디언) 추가.
        
- **4단계: 크로스 컴파일 최적화 및 최종 검증 (4주 차)**
    
    - RocksDB 컴파일 내장화에 따른 Windows, macOS, Linux 플랫폼별 타깃 크로스 컴파일(GitHub Actions CI) 빌드 가이드 튜닝.
        
    
    - 비동기 데이터 주입 시 발생할 수 있는 레이스 컨디션 방지 및 오프라인 하이브리드 검색 레이턴시 최종 최적화 점검 후 릴리즈.
        

## 7. 안티그래비티 가동을 위한 프롬프트 가이드 (AI Agent Instruction)

Plaintext

```
안티그래비티 에이전트, 현재 WorkAssist V2 프로젝트는 2단계까지 완료되었으며 3단계 History Manager 및 Oxigraph 연동을 시작합니다.
1) calamine 크레이트로 엑셀 BOM의 품번과 수량을 추출하고,
2) 프로젝트 코드/담당자/고객사 메타 정보와 함께 oxigraph 스토어에 RDF 트리플 구조로 영구 적재하며,
3) 주요 산출물 PDF를 opendataloader-pdf 기반으로 텍스트 정제 후 lancedb에 태깅해 저장하는 
통합 오프라인 백엔드 인게스션 코드를 Rust로 작성해 주세요.
```